-- Fleet MCv2 — RLS for the four work-centric tables.
-- Posture: RLS enabled, ZERO policies (deny-all) + grants revoked from
-- anon/authenticated. Only service_role (ingest fn / authed cockpit routes)
-- bypasses RLS. Identical to fleet_machine_secrets / fleet_job_links (P0). The
-- "RLS enabled, no policy" linter notice on these four is INTENDED.
-- None of these tables joins the anon read surface or the realtime publication.

alter table public.fleet_projects  enable row level security;
alter table public.fleet_waves     enable row level security;
alter table public.fleet_sessions  enable row level security;
alter table public.fleet_decisions enable row level security;

-- Belt-and-suspenders: no anon/authenticated privileges at all (deny-all).
revoke all on public.fleet_projects  from anon, authenticated;
revoke all on public.fleet_waves     from anon, authenticated;
revoke all on public.fleet_sessions  from anon, authenticated;
revoke all on public.fleet_decisions from anon, authenticated;
