-- Fleet Mission Control — MCv2 (M1) work-centric spine.
-- Project → Wave → Session → Decision, joined to (NOT replacing) the v1
-- machine-centric tables (fleet_machines/jobs/job_links). All four are PRIVATE:
-- RLS + zero-policy deny-all + revoked grants live in the sibling
-- 20260722090100_fleet_mcv2_rls.sql migration (same split as P0 schema/rls).
-- Nothing here joins the realtime publication or the anon surface.
--
-- PROPOSED — the planner applies this; it is NOT run against the live project by
-- the building session. Idempotent (`if not exists` / `on conflict do nothing`).

-- ── Projects: the repo registry the cockpit dispatches against ─────────────────
create table if not exists public.fleet_projects (
  id             uuid primary key default gen_random_uuid(),
  name           text not null unique,                  -- workspace name ('portfolio')
  repo           text,                                  -- github slug 'owner/name'
  default_branch text not null default 'main',
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
comment on table public.fleet_projects is
  'MCv2: dispatchable project registry. Private (service-role only).';

-- ── Waves: a dispatched set of sessions, registered by a launcher ─────────────
create table if not exists public.fleet_waves (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references public.fleet_projects(id) on delete cascade,
  name           text not null,
  status         text not null default 'draft'
                   check (status in ('draft','dispatched','reviewing','done','abandoned')),
  registered_by  uuid references public.fleet_machines(id) on delete set null,  -- audit: who registered
  dispatched_at  timestamptz,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists fleet_waves_project_idx
  on public.fleet_waves (project_id, created_at desc);
comment on table public.fleet_waves is
  'MCv2: a dispatched set of sessions. Registered by the launcher at dispatch. Private.';
comment on column public.fleet_waves.registered_by is
  'Machine that POSTed the register block (history/audit). Null if unknown.';

-- ── Sessions: the work item. Nullable wave_id => the "ungrouped" bucket ───────
-- AUTHORITY RULE: fleet_sessions is authoritative for the work-centric read model
-- the cockpit reads (status, last_message, rc_url, pr_url). fleet_job_links keeps
-- its own unchanged copy for the machine-centric v1 dashboard. Both are written
-- from the SAME job record in the SAME ingest pass with preserve-on-null, so they
-- cannot drift; neither is derived from the other. See docs/SCHEMA_V2.md.
create table if not exists public.fleet_sessions (
  id            uuid primary key default gen_random_uuid(),
  wave_id       uuid references public.fleet_waves(id)  on delete set null,   -- null = ungrouped
  machine_id    uuid references public.fleet_machines(id) on delete set null,
  job_id        uuid references public.fleet_jobs(id)   on delete set null,   -- machine-centric join
  name          text not null,                          -- tmux/job name (mirrors fleet_jobs.name)
  project       text,
  repo          text,
  branch        text,
  worktree      text,
  prompt_ref    text,                                   -- 'ops/prompts/PROMPT_x.md'
  directive     text,                                   -- dispatched directive text
  model         text,
  status        text not null default 'planned'
                  check (status in ('planned','running','waiting','done','reviewed','merged','rejected')),
  last_message  text,
  rc_url        text,
  pr_url        text,
  dispatched_at timestamptz,
  started_at    timestamptz,
  ended_at      timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
-- One ACTIVE (non-terminal) session per (machine,name) — the enrichment match key,
-- mirroring v1's `fleet_jobs_active_uniq`. Terminal rows (done/reviewed/merged/
-- rejected) are exempt so a reused branch name starts a fresh session cleanly.
create unique index if not exists fleet_sessions_active_uniq
  on public.fleet_sessions (machine_id, name)
  where (status in ('planned','running','waiting'));
create index if not exists fleet_sessions_wave_idx
  on public.fleet_sessions (wave_id);
create index if not exists fleet_sessions_job_idx
  on public.fleet_sessions (job_id);
create index if not exists fleet_sessions_machine_name_idx
  on public.fleet_sessions (machine_id, name);
-- Supports step 2b (Terminal.app fallback): match on (machine,project,branch).
create index if not exists fleet_sessions_machine_project_branch_idx
  on public.fleet_sessions (machine_id, project, branch);
comment on table public.fleet_sessions is
  'MCv2: a Code run as a work item. Authoritative for cockpit fields. Private. wave_id null = ungrouped.';

-- ── Decisions: append-only operator verdicts on a session ─────────────────────
create table if not exists public.fleet_decisions (
  id         uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.fleet_sessions(id) on delete cascade,
  action     text not null
               check (action in ('approve_merge','redispatch_with_feedback','reject')),
  feedback   text,
  created_at timestamptz not null default now()
);
create index if not exists fleet_decisions_session_idx
  on public.fleet_decisions (session_id, created_at desc);
comment on table public.fleet_decisions is
  'MCv2: append-only operator decisions on a session. Private.';

-- ── Seed the known fleet (idempotent). Repo owner = vishal-h-pathak (git remote).
-- Names track ~/dev/jarvis/memory/INDEX.md. Add/rotate freely; on-conflict-safe.
insert into public.fleet_projects (name, repo, default_branch) values
  ('fleet-mission-control', 'vishal-h-pathak/fleet-mission-control', 'main'),
  ('portfolio',             'vishal-h-pathak/portfolio',             'main'),
  ('cellular-gaits',        'vishal-h-pathak/cellular-gaits',        'main'),
  ('jobify',                'vishal-h-pathak/jobify',                'main'),
  ('caddiehack',            'vishal-h-pathak/caddiehack',            'main'),
  ('camera-whispr-llm',     'vishal-h-pathak/camera-whispr-llm',     'main')
on conflict (name) do nothing;
