# Phase D — Bus ingestion path for completion records (F2-b)

> PHASE D, feature F2-b. Read `ops/prompts/PROMPT_fleet_conventions.md` first. Branch:
> `feat/fleet-phaseD-bus`. Fleet repo: `supabase/` (function + migration) + `index.mjs` (reporter) +
> `agent/` if needed. **This session is SCHEMA-TOUCHING.** The data layer is FROZEN and planner-owned
> (conventions §"data layer is LIVE and FROZEN"): you **PROPOSE the migration and STOP** — do not run
> migrations, do not alter tables, do not deploy `ingest` against prod without explicit approval.
> Sibling of F2-a `hook` (which POSTs the records you ingest); contract is in that prompt + below.

## Goal
Let a finished Code session's completion record — carrying its **final message** + `/rc` link — land
in the bus through `ingest`, respecting the public/private split, with **no duplicate finished rows**
and the reporter's tmux-disappear detection kept as the crash backstop (no double-notify, since only
the hook pushes to the human).

## Event store (decided: reuse `ingest`, add ONE private column)
- A completion is already a `fleet_jobs` row going `status:"finished"` (public — keep it public).
- `last_assistant_message` is sensitive output → it goes in **private `fleet_job_links`**, alongside
  `rc_url`/`cmd`/`log_tail`. Add a **`last_message text`** column to `fleet_job_links` (or, if you make
  a strong case, reuse the existing `log_tail` — but a dedicated column is clearer; recommend the new
  column). **No `fleet_events` table** this phase (deferred until a second event type needs it).
- The migration is a single additive column. Write it as a new file in `supabase/migrations/` and
  **STOP for approval before applying** (the planner applies it / approves `apply_migration`).

## `ingest` change — accept `last_message`, fix finished-row idempotency
- Extend the `ingest` job handling so a job entry's `last_message` (when present) is written to
  `fleet_job_links` (private), exactly like `rc_url`/`log_tail` are today. Never let it reach a public
  field.
- **Fix the duplicate-finished bug (the one real reconcile):** today `ingest` finds an existing job by
  `status='running'`. A hook (or the reporter backstop) POSTing `status:"finished"` finds no running
  row and **inserts a brand-new finished row** → duplicates, and the hook's rich record and the
  reporter's bare record can both land. Make finished upserts idempotent for a session. Decide and
  implement the key:
  - **(preferred)** match the **most-recent row for `(machine_id, name)` regardless of status** and
    update it (so the running row transitions to finished, and a later bare reporter `finished` updates
    the same row without nulling `last_message`); OR
  - key on a stable session id if `cockpit.sh`/the hook can supply one.
  Whichever you pick: a hook `finished` record and a reporter `finished` record for the same session
  must converge on **one** row, and the reporter's record must **not overwrite** a non-null
  `last_message`/`rc_url` with null (preserve-on-null semantics for private fields).

## Reporter (`index.mjs`) — backstop, no push, no clobber
- Keep tmux-disappear → `status:"finished"` as the crash/kill backstop (hooks don't fire on hard kill).
- The reporter must **not** push to the human (the hook owns the human push → no double-notify).
- Ensure the reporter's finished heartbeat doesn't clobber a richer hook record (preserve-on-null, per
  above). Zero new deps; stay ESM/Node 18+.

## Acceptance (validate, then STOP and report)
1. Migration file written (single additive private column) — **presented, NOT applied.** Show the SQL.
2. Against a branch/preview (or a dry description if no preview): a job POST with `last_message` routes
   it to **private** `fleet_job_links`; the public `fleet_jobs`/`fleet_machine_status` surface leaks no
   message text. Confirm RLS: `last_message` is unreadable with the anon key.
3. Idempotency proven: simulate running→finished(hook, with message)→finished(reporter, bare) for one
   `(machine,name)` → exactly **one** job row, `last_message` retained (not nulled). Show the logic/test.
4. Reporter doesn't push and doesn't clobber; parity/allowlist tests (if touched) still green. No new
   deps. Report what's verified vs. pending the planner applying the migration + redeploying `ingest`.

Do not begin until I confirm. (I apply the migration + deploy `ingest`.)
