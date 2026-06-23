-- Fleet Mission Control — Cowork "what finished?" canonical query (Phase D / F2-c)
-- =============================================================================
-- "Delegated Code sessions that finished in the last N hours that I haven't seen."
-- A Cowork session (or a person) runs this verbatim against the live fleet bus
-- (Supabase project sbmsxerwgylpfkkkjtku) to close the plan → delegate → execute →
-- report-back loop with no manual paste. See docs/COWORK_INGEST.md for the prose.
--
-- TWO READS, split at the trust boundary the DB already enforces:
--   A) PUBLIC  (anon/publishable key OR service-role) — fleet_jobs only → THAT it finished.
--   B) PRIVATE (service-role ONLY, behind auth)       — fleet_job_links → the last_message + /rc.
-- Anon can read A; anon is denied B at the grant level (permission denied for
-- table fleet_job_links, SQLSTATE 42501) — never ship B to a public client.
--
-- Parameters (3 places, same in both queries — edit inline before running):
--   ⟨hours⟩    lookback window, e.g. 24
--   ⟨machine⟩  machine name filter, or NULL for all   (e.g. 'sentry', 'mac-cockpit')
--   ⟨project⟩  project filter, or NULL for all        (e.g. 'cellular-gaits')
-- "Haven't seen" cursor: bump ⟨hours⟩ down, or swap the time predicate for
--   coalesce(j.ended_at, j.updated_at) > '<last-seen-iso-ts>'.
-- Ordering/filtering uses coalesce(ended_at, updated_at): the reporter's
-- tmux-disappear backstop marks a job finished with a NULL ended_at, so we fall
-- back to updated_at to still surface (and sort) those.


-- ─────────────────────────────────────────────────────────────────────────────
-- A) PUBLIC READ — "what finished" (safe for the anon/publishable key)
--    Recently finished/failed delegated sessions. kind='claude-session' is the
--    delegated `cg run` headless executor; drop the kind filter for ALL jobs.
-- ─────────────────────────────────────────────────────────────────────────────
select
  m.name                                as machine,
  j.name                                as session,
  j.project,
  j.status,                                            -- finished | failed | stopped
  coalesce(j.ended_at, j.updated_at)    as finished_at,
  j.exit_code
from public.fleet_jobs j
join public.fleet_machines m on m.id = j.machine_id
where j.status in ('finished', 'failed', 'stopped')
  and j.kind = 'claude-session'                        -- delegated Code sessions only
  and coalesce(j.ended_at, j.updated_at) >= now() - (interval '1 hour' * 24)   -- ⟨hours⟩
  and (m.name  = nullif('', '') or nullif('', '') is null)                     -- ⟨machine⟩: put name in BOTH '' slots, or leave blank for all
  and (j.project = nullif('', '') or nullif('', '') is null)                   -- ⟨project⟩: put project in BOTH '' slots, or leave blank for all
order by finished_at desc nulls last
limit 50;


-- ─────────────────────────────────────────────────────────────────────────────
-- B) PRIVATE READ — "what it said + /rc" (SERVICE-ROLE ONLY — behind auth)
--    Same trust level as the dashboard's authed API routes. The join to
--    fleet_job_links exposes last_message + rc_url, which are CAPABILITIES:
--    anyone holding rc_url can drive the live session. NEVER run this with the
--    anon key (it is denied) and NEVER surface its output to a public client.
-- ─────────────────────────────────────────────────────────────────────────────
select
  m.name                                as machine,
  j.name                                as session,
  j.project,
  j.status,
  coalesce(j.ended_at, j.updated_at)    as finished_at,
  l.last_message,                                      -- PRIVATE: final assistant message
  l.rc_url                                             -- PRIVATE: /rc steering capability
from public.fleet_jobs j
join public.fleet_machines m on m.id = j.machine_id
left join public.fleet_job_links l on l.job_id = j.id
where j.status in ('finished', 'failed', 'stopped')
  and j.kind = 'claude-session'
  and coalesce(j.ended_at, j.updated_at) >= now() - (interval '1 hour' * 24)   -- ⟨hours⟩
  and (m.name  = nullif('', '') or nullif('', '') is null)                     -- ⟨machine⟩
  and (j.project = nullif('', '') or nullif('', '') is null)                   -- ⟨project⟩
order by finished_at desc nulls last
limit 50;
