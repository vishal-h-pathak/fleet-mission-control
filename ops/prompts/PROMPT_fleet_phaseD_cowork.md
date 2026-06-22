# Phase D — Cowork ingestion of completion records (F2-c, the last mile)

> PHASE D, feature F2-c. Read `ops/prompts/PROMPT_fleet_conventions.md` first. Branch:
> `feat/fleet-phaseD-cowork`. Fleet repo `docs/` (+ a small read query/helper). **Depends on F2-b
> `bus`**: the record shape (`fleet_jobs.status='finished'` + private `fleet_job_links.last_message` +
> `rc_url`) must be settled first. Honest constraint: **Cowork cannot be pushed to — it reads.**
> This closes the loop with **no manual paste**, no per-project wiring.
>
> NOTE: most of this is a documented read pattern Cowork itself runs via the Supabase MCP — it may not
> need much (or any) committed code. Scope to docs + a reusable query; don't over-build.

## Goal
A Cowork session can learn that a delegated Code session finished and read its result (final message +
`/rc` link) directly from the fleet Supabase bus, on demand or on one global schedule — the same bus
the dashboard uses. No paste, no babysitting the terminal.

## Deliverables
1. **A documented read pattern** in `docs/` (e.g. extend `HOW_IT_WORKS.md` or a short
   `docs/COWORK_INGEST.md`): the exact Supabase MCP query a Cowork session runs to list recently
   finished delegated jobs and fetch each one's `last_message` + `rc_url`. Cover both:
   - **public read** (anon/publishable): recently `finished`/`failed` `fleet_jobs` (machine, name,
     project, ended_at) — enough to know *that* something finished;
   - **private read** (service-role, behind auth — same trust level as the dashboard's authed routes):
     `fleet_job_links.last_message` + `rc_url` — the *what*. Spell out plainly that the message/`/rc`
     are private and read with the service-role key only, never anon. (Reconfirm with the `bus` schema.)
2. **A canonical query** (a saved `.sql` under `ops/` or a snippet in the doc) — "delegated sessions
   finished in the last N hours that I haven't seen", parameterized by machine/project/time — so a
   Cowork session (or a person) can run it verbatim.
3. **Ingestion mode (recommend + document, don't necessarily build):** (a) on-demand Cowork read
   (recommended default — a Cowork session just asks "what finished?"), and/or (b) **one global Cowork
   scheduled task** (set up once on the account, not per project) that polls the bus and surfaces
   finished runs. Describe how to set up (b) if wanted; the on-demand read needs nothing standing.

## Acceptance (validate, then STOP and report)
1. Running the documented public query returns recently finished delegated jobs from the live bus
   (paste a real result). Running the documented private read returns `last_message` + `rc_url` for one
   of them under service-role/auth, and the **anon** key returns neither (confirm the split holds).
2. The doc states clearly: public = "it finished"; private (authed/service-role) = the message + `/rc`;
   and the one-global-scheduled-task option with setup notes. No secret committed; no per-project wiring.
3. Report whether anything beyond docs+query was actually needed, and confirm a Cowork session could
   close the loop with no manual paste.

Do not begin until I confirm.
