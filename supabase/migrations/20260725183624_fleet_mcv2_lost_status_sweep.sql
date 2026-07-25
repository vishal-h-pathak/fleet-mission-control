-- Fleet MCv2 — staleness sweep: 'lost' session status + pg_cron sweeper, plus
-- 'dismissed' decision action (cockpit noise-dismiss). See docs/SCHEMA_V2.md.
--
-- Motivating gap (wave 2 hardening, found operating wave 1 live): a Terminal/GUI
-- Code session killed abruptly never fires SessionEnd, so its fleet_sessions row
-- sits `running`/`planned` forever — the reporter's tmux crash-backstop only
-- covers tmux-tracked jobs, not these. This sweep flips demonstrably-stale
-- non-terminal rows to a new telemetry-terminal status so the cockpit stops
-- treating them as live work, without ever touching an operator's own decision.
--
-- PROPOSED — the planner applies this; it is NOT run against the live project by
-- the building session.

-- ── 'lost' joins fleet_sessions.status (telemetry-terminal, like 'done') ──────
alter table public.fleet_sessions drop constraint if exists fleet_sessions_status_check;
alter table public.fleet_sessions add constraint fleet_sessions_status_check
  check (status in ('planned','running','waiting','done','reviewed','merged','rejected','lost'));

-- ── 'dismissed' joins fleet_decisions.action (cockpit noise-dismiss; sibling
--    waves-board wave builds the UI. decision -> session status 'reviewed',
--    same as approve_merge/redispatch_with_feedback — see docs/SCHEMA_V2.md.)
alter table public.fleet_decisions drop constraint if exists fleet_decisions_action_check;
alter table public.fleet_decisions add constraint fleet_decisions_action_check
  check (action in ('approve_merge','redispatch_with_feedback','reject','dismissed'));

-- ── Staleness sweeper ───────────────────────────────────────────────────────
-- Guardrails (hard):
--   • never touches 'done' or any operator-terminal row (reviewed/merged/rejected)
--     — the WHERE clauses only ever target status='running' or status='planned'.
--   • 'running' -> 'lost' requires BOTH: no LIVE linked fleet_jobs row (status
--     'running' AND heartbeated within the last 30 minutes — recency, not just
--     status, because a one-shot GUI session's job row can sit at status='running'
--     forever with no further heartbeat ever updating it; checking status alone
--     would make this predicate never fire for the exact case it exists for), AND
--     the session row itself hasn't moved in >=12h (generous — an abrupt-kill
--     detector, not a "looks quiet" heuristic).
--   • 'planned' -> 'lost' requires dispatched_at >=48h old (longer horizon: a
--     planned session may legitimately sit unstarted for a while). No linked job
--     exists yet for a planned session, so no job-side check applies.
--
-- Closing the linked fleet_jobs row (-> 'stopped') when a running session goes
-- lost is NOT incidental cleanup — it's required for correctness. v1's job upsert
-- (kept, not rebuilt) only reuses an existing fleet_jobs row while its status is
-- 'running'; leaving it at 'running' forever would mean the NEXT real telemetry
-- record for the same (machine,name) silently rebinds to the dead job_id and
-- lands right back on the lost session via ingest's job_id anchor (no status
-- filter, by design, so a single lifecycle survives running->finished) — breaking
-- the "a later real record for the same (machine,name) must start a fresh
-- session" requirement. Closing the job preserves v1's own job_id-freshness
-- guarantee. A genuinely late TERMINAL record for the dead lifecycle still finds
-- the same (now-stopped) job row via v1's existing by-name terminal fallback
-- (matches regardless of status when the incoming record is itself terminal), so
-- session-logic.mjs's nextSessionStatus('lost', true) => 'done' still fires
-- correctly (see the ingest test's race-matrix cases).
create or replace function public.fleet_sweep_stale_sessions()
returns void
language plpgsql
as $$
declare
  v_now timestamptz := now();
  v_lost_job_ids uuid[];
begin
  with newly_lost as (
    update public.fleet_sessions s
    set status = 'lost', updated_at = v_now
    where s.status = 'running'
      and s.updated_at < v_now - interval '12 hours'
      and not exists (
        select 1 from public.fleet_jobs j
        where j.id = s.job_id
          and j.status = 'running'
          and j.updated_at > v_now - interval '30 minutes'
      )
    returning job_id
  )
  select array_agg(job_id) filter (where job_id is not null)
  into v_lost_job_ids
  from newly_lost;

  if v_lost_job_ids is not null then
    update public.fleet_jobs
    set status = 'stopped', updated_at = v_now,
        ended_at = coalesce(ended_at, v_now)
    where id = any(v_lost_job_ids) and status = 'running';
  end if;

  update public.fleet_sessions s
  set status = 'lost', updated_at = v_now
  where s.status = 'planned'
    and s.dispatched_at is not null
    and s.dispatched_at < v_now - interval '48 hours';
end;
$$;
comment on function public.fleet_sweep_stale_sessions() is
  'MCv2: flips demonstrably-stale running/planned fleet_sessions rows to lost (closing their linked fleet_jobs row for running->lost, so v1''s job_id-freshness guarantee holds). Never touches done/operator-terminal rows. Scheduled via pg_cron below.';

-- Already created by the P0 retention migration; idempotent re-declare for
-- self-containment (this file, read alone, is a complete unit).
create extension if not exists pg_cron;

select cron.unschedule('fleet_sweep_stale_sessions')
  where exists (select 1 from cron.job where jobname = 'fleet_sweep_stale_sessions');

select cron.schedule(
  'fleet_sweep_stale_sessions',
  '*/30 * * * *',
  $$select public.fleet_sweep_stale_sessions();$$
);
