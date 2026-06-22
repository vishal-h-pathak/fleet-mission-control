-- Fleet Phase D (F2-b) — bus ingestion path for completion records.
-- Single additive private column: the final assistant message of a finished
-- Code session (carried by the SessionEnd hook, F2-a) lands here, alongside
-- rc_url/cmd/log_tail. SENSITIVE output → private fleet_job_links only.
--
-- No RLS change needed: fleet_job_links already has RLS enabled with zero
-- policies (deny-all) and grants revoked from anon/authenticated; only
-- service_role (the ingest function / authed API routes) bypasses RLS. The new
-- column inherits that deny-all posture — never anon-readable.

alter table public.fleet_job_links
  add column if not exists last_message text;

comment on column public.fleet_job_links.last_message is
  'Private: final assistant message of a finished Code session (SessionEnd hook). Service-role only; never anon-readable.';
