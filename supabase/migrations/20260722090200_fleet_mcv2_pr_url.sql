-- Fleet MCv2 (M1) — v1 touch-up: pr_url on fleet_job_links.
-- The auto-draft-PR completion hook (sibling M0 session, feat/mcv2-hook-pr) sends
-- pr_url on its jobs[] entry; ingest v5 routes it to private storage here AND to
-- fleet_sessions.pr_url (dual-write, preserve-on-null). SENSITIVE like rc_url — a
-- draft-PR URL leaks repo + branch + content — so it lands in the private links
-- table, never the public surface.
--
-- No RLS change: fleet_job_links already has RLS enabled with zero policies
-- (deny-all) and grants revoked from anon/authenticated; the new column inherits
-- that deny-all posture. Mirrors 20260622160000_fleet_phaseD_last_message.sql.

alter table public.fleet_job_links
  add column if not exists pr_url text;

comment on column public.fleet_job_links.pr_url is
  'Private: draft/open PR URL for a finished Code session (auto-PR hook). Service-role only; never anon-readable.';
