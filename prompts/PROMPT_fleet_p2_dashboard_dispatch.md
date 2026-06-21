# P2-B — Dashboard: authed command dispatch

> PHASE 2. Do not start until the planner has applied the `fleet_commands` schema and confirmed.
Read `prompts/PROMPT_fleet_conventions.md` first. Branch: `feat/fleet-p2-dashboard-dispatch`.
Folder: `web/`.

## Goal
An **authed** panel to dispatch allowlisted commands to a machine and watch the result — the
front end of the control plane. Everything here is behind the existing auth gate; nothing about
command dispatch touches the public surface.

## What to build
- **Server route (service role, authed only):** `POST /api/command` — body `{ machine_id, verb, args }`.
  Gated by the existing auth cookie/middleware. Validate `verb` against the SAME allowlist the agent
  enforces (keep the list in one shared module so UI and agent can't drift). Insert a `pending` row
  into `fleet_commands` with `requested_by` = the authed session. Never accept a free-text command.
- **Dispatch UI (authed view only):** pick a machine (from `fleet_machines`), pick a verb from the
  allowlist (with typed arg inputs where needed, e.g. `artifact <relpath>`), submit. Show the
  command's lifecycle (`pending→claimed→running→done/error`) and the returned `result`/`exit_code`,
  updating via realtime on `fleet_commands`.
- **Public surface unchanged:** unauthenticated users see none of this — no dispatch UI, no command
  history, no `fleet_commands` data. Confirm the anon client cannot read `fleet_commands` at all.

## Acceptance (validate, then STOP and report)
1. `npm run build` green.
2. Unauthed: `POST /api/command` → 401; the dispatch UI is not reachable; anon cannot read
   `fleet_commands`. Confirm explicitly.
3. Authed: submitting `verb:"check"` for a machine inserts a `pending` row and the UI reflects the
   status transitions + result (end-to-end with the P2 agent running, or with a simulated agent
   update). Verbs outside the allowlist are rejected client- and server-side.
4. The allowlist is a single shared source of truth. Report real vs. stubbed.

Do not begin until I confirm.
