# MCv2 — M1: Work-centric schema v2 + wave registration + ingest v5

> MISSION CONTROL v2, milestone M1. Read `ops/prompts/PROMPT_fleet_conventions.md` first, then
> `docs/V2_PLAN.md` (§2 core objects) and `docs/SCHEMA.md` (the live v1 model). Branch:
> `feat/mcv2-schema`. Scope: `supabase/migrations/` (**PROPOSE only**), `supabase/functions/`
> (code on the branch, **do not deploy**), new `ops/bin/`, `docs/`. No `web/`, no `cockpit/`,
> no `deploy/hooks/` (sibling `hook-pr` session owns the hook; coordinate on the `pr_url`
> contract).
>
> The conventions file says the data layer is frozen and ingest untouchable — **for this
> session that freeze is lifted for CODE on your branch**: designing the v2 migrations and
> ingest v5 *is* your task. The planner-owned parts remain: you PROPOSE migrations and STOP;
> the planner applies them and deploys functions at consolidation. Never run
> `supabase db push`/`migration up`/DDL against the live project, never deploy an Edge Function.

## Goal
Give the bus a **work-centric spine** the cockpit can be built on: Project → Wave → Session →
Decision, joined to (not replacing) the machine-centric v1 tables, plus the write paths that
populate it: launcher-side wave registration at dispatch, and hook/reporter-driven session
enrichment at completion.

## 1. Migrations (PROPOSE, don't apply)
New `fleet_`-prefixed tables in the shared project, **all private**: RLS enabled, zero
policies (deny-all, service-role only — same as `fleet_job_links`). None join the realtime
publication or the anon surface.

- `fleet_projects` — name (unique), github repo slug (`owner/name`), default_branch, active,
  timestamps. Seed migration data for the known fleet: at least `fleet-mission-control`,
  `portfolio`, `cellular-gaits`, `jobify`, `caddiehack`, `camera-whispr-llm` (check
  `~/dev/jarvis/memory/INDEX.md` naming if unsure; seeding is idempotent inserts).
- `fleet_waves` — project_id FK, name, status (`draft|dispatched|reviewing|done|abandoned`),
  dispatched_at, notes, timestamps.
- `fleet_sessions` — the work item: wave_id FK **nullable** (null = the "ungrouped" bucket),
  machine_id FK, nullable job_id FK → `fleet_jobs` (the machine-centric join), repo, branch,
  worktree path, prompt ref (e.g. `ops/prompts/PROMPT_x.md`) and/or dispatched directive text,
  model, status `planned|running|waiting|done|reviewed|merged|rejected` (constrained),
  last_message, rc_url, pr_url, dispatched_at/started_at/ended_at/updated_at. Unique-ish
  matching key for enrichment: (machine_id, name) — mirror v1's partial-unique approach for
  active rows. You own the exact shape; keep duplication with `fleet_job_links` minimal and
  justified (state the rule you choose in the doc: which store is authoritative for
  last_message/rc_url/pr_url and why — don't let two copies drift silently).
- `fleet_decisions` — append-only: session_id FK, action
  (`approve_merge|redispatch_with_feedback|reject`), feedback text, created_at.
- v1 touch-up: `pr_url` column on `fleet_job_links` (the hook already sends it — sibling
  session), preserve-on-null like the other private fields.

## 2. Ingest v5 (code on branch, not deployed)
- Accept `pr_url` in `jobs[]` → route to private storage, preserve-on-null.
- **Session enrichment:** when a `claude-session` record arrives (running from the reporter,
  finished from the hook), match `fleet_sessions` on (machine_id, name) against non-terminal
  status: flip `planned→running`, `running→done` (a hook-carried "needs you"/waiting signal is
  out of scope for now), fill last_message/rc_url/pr_url/ended_at per your authority rule.
  **No match ⇒ create an ungrouped session row** (wave_id null) so out-of-launcher dispatches
  still surface. Preserve v1's idempotency guarantees exactly (one row per (machine, name)
  lifecycle, no clobber-to-null, hook + reporter-backstop converge) — this is the subtle part;
  reason through the same race matrix `docs/LOOP_CLOSER.md` did.
- **Wave registration path:** a token-authed way for launchers to say "wave W of project P =
  sessions S1..Sn (branch, machine, model, prompt) — planned". Either a `register` block in the
  ingest payload or a small separate Edge Function — your call; justify it (auth = existing
  per-machine bearer token; strict field validation; no arbitrary strings executed anywhere —
  this only *records* intent, dispatch stays where it is today).

## 3. Registration CLI — `ops/bin/fleet-register-wave.mjs`
Zero-dep Node 18+ ESM (house style: `index.mjs`). Reads a small JSON manifest (or flags),
POSTs the registration, prints the wave/session ids. `--dry-run` prints the payload without
POSTing. Wave launchers will call this at dispatch; add a short example block to
`ops/README.md` showing how a `setup-*.sh` integrates it (do not rewrite existing launchers).

## 4. Contract doc
`docs/SCHEMA_V2.md`: tables, the enrichment matching rules + authority rule, the registration
payload, and the exact status-transition table. The `inbox` session (next stage) and future
`cockpit/` work build from THIS doc — write it like `docs/SCHEMA.md`, terse and exact.

## Acceptance (validate, then STOP and report)
1. Migrations are complete, ordered, idempotent-where-seeding, and lint clean (`supabase` CLI
   dry parse if available locally; else careful reasoning + note it). **Not applied.**
2. Ingest v5 compiles/typechecks; the enrichment + registration logic covered by whatever unit
   pattern the existing function uses (add one if none — even a plain node test file); walk the
   race matrix (reporter-first vs hook-first vs both, registered vs unregistered) in the report.
3. `fleet-register-wave.mjs --dry-run` demonstrably produces a valid payload.
4. `docs/SCHEMA_V2.md` complete. Report: proposed migration list (filenames), the authority
   rule you chose, the registration design (ingest-block vs new function) and why, and the
   `pr_url` contract as agreed with the `hook-pr` sibling.

> Before you STOP and report, in this exact order — never STOP dirty:
> 1. `git add -A && git commit -m "<clear message>"` on your branch.
> 2. `git push -u origin <branch>` — if push fails, run `cg artifact <path>` as the fallback and note it.
> 3. Only now STOP and report: **branch**, **commit SHA** (`git rev-parse --short HEAD`), and
>    **push result** (pushed / failed: why / artifact-fallback). Don't merge.

Do not begin until I confirm.
