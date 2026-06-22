-- Phase C — approval-gating for powerful verbs.
-- A mutating command (run / nav / stop) is inserted as 'awaiting_approval' and the agent
-- (which only ever claims status='pending') cannot touch it until a second authed action
-- flips it to 'pending' and stamps approved_by/approved_at. Safe verbs skip straight to 'pending'.
alter table public.fleet_commands
  drop constraint if exists fleet_commands_status_check;
alter table public.fleet_commands
  add constraint fleet_commands_status_check
  check (status in ('awaiting_approval','pending','claimed','running','done','error','rejected'));

alter table public.fleet_commands add column if not exists approved_by text;
alter table public.fleet_commands add column if not exists approved_at timestamptz;
