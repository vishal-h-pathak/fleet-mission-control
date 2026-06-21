-- Fleet P0 — RLS + explicit grants. Enforces "public shell + authed controls" in the DB.

-- Enable RLS everywhere.
alter table public.fleet_machines        enable row level security;
alter table public.fleet_machine_secrets enable row level security;
alter table public.fleet_heartbeats      enable row level security;
alter table public.fleet_jobs            enable row level security;
alter table public.fleet_job_links       enable row level security;

-- Public read surface: anon + authenticated may SELECT (no write policies => no writes).
drop policy if exists fleet_machines_public_read on public.fleet_machines;
create policy fleet_machines_public_read on public.fleet_machines
  for select to anon, authenticated using (true);

drop policy if exists fleet_heartbeats_public_read on public.fleet_heartbeats;
create policy fleet_heartbeats_public_read on public.fleet_heartbeats
  for select to anon, authenticated using (true);

drop policy if exists fleet_jobs_public_read on public.fleet_jobs;
create policy fleet_jobs_public_read on public.fleet_jobs
  for select to anon, authenticated using (true);

-- Private tables (fleet_machine_secrets, fleet_job_links): RLS enabled with NO
-- policies => anon/authenticated denied entirely. service_role bypasses RLS;
-- the ingest function + authed API routes use it. (The "RLS enabled, no policy"
-- linter notice on these two tables is the INTENDED deny-all posture.)

-- Belt-and-suspenders: explicit table privileges (don't rely on defaults).
revoke all on public.fleet_machine_secrets from anon, authenticated;
revoke all on public.fleet_job_links      from anon, authenticated;
revoke all on public.fleet_machines       from anon, authenticated;
revoke all on public.fleet_heartbeats     from anon, authenticated;
revoke all on public.fleet_jobs           from anon, authenticated;

grant select on public.fleet_machines       to anon, authenticated;
grant select on public.fleet_heartbeats     to anon, authenticated;
grant select on public.fleet_jobs           to anon, authenticated;
grant select on public.fleet_machine_status to anon, authenticated;
