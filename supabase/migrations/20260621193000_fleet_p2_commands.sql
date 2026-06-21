-- Fleet P2 — control plane command queue. SECURITY-SENSITIVE.
-- No anon/authenticated access at all (deny-all RLS). Writes come from the authed
-- dashboard server route (service role); machines claim/complete via the token-authed
-- `commands` Edge Function. The verb allowlist is enforced in code (agent + dashboard),
-- not here — the DB stays permissive on `verb` and the agent rejects unknown verbs.
create table if not exists public.fleet_commands (
  id           uuid primary key default gen_random_uuid(),
  machine_id   uuid not null references public.fleet_machines(id) on delete cascade,
  verb         text not null,
  args         jsonb not null default '{}'::jsonb,
  status       text not null default 'pending'
                 check (status in ('pending','claimed','running','done','error','rejected')),
  requested_by text,
  created_at   timestamptz not null default now(),
  claimed_at   timestamptz,
  finished_at  timestamptz,
  result       jsonb,
  exit_code    integer
);
create index if not exists fleet_commands_machine_status_idx
  on public.fleet_commands (machine_id, status, created_at);

-- Deny-all: RLS on, NO policies for anon/authenticated. service_role bypasses (Next route +
-- commands Edge Function). Intended "RLS enabled, no policy" posture. NOT in realtime publication.
alter table public.fleet_commands enable row level security;
revoke all on public.fleet_commands from anon, authenticated;
