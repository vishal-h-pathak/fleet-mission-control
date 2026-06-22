# P2-B — Dashboard: authed command dispatch

> PHASE 2. The `fleet_commands` schema is applied (deny-all RLS; service-role only).
Read `prompts/PROMPT_fleet_conventions.md` first. Branch: `feat/fleet-p2-dashboard-dispatch`.
Folder: `web/`.

## Goal
An **authed** panel to dispatch allowlisted commands to a machine and watch the result — the front
end of the control plane. Everything here is behind the existing auth gate; command data never
touches the public surface (`fleet_commands` is deny-all to anon/authenticated — only the service
role, server-side, can read/write it).

## Routes (server-only, service role, behind the existing auth cookie/middleware)
- `POST /api/command` — body `{ machine_id, verb, args }`. Validate `verb` against the SHARED
  allowlist module (the same one the agent uses — keep it in one file so UI and agent can't drift).
  Reject anything off-list. Insert a `pending` row into `fleet_commands` with `requested_by` = the
  authed session. Never accept a free-text command.
- `GET /api/commands?machine_id=…&limit=…` — returns recent commands + their status/result for the
  dispatch UI to render. (Polling, not realtime: `fleet_commands` is intentionally not in the
  realtime publication and not anon-readable.)
- Add both routes to `middleware.ts`. Mirror the existing `/api/job/[id]/links` auth exactly.

## Dispatch UI (authed view only)
- Pick a machine (from `fleet_machines`), pick a verb from the allowlist (typed arg inputs where
  needed, e.g. `artifact <relpath>`), submit → `POST /api/command`.
- Show each command's lifecycle (`pending→claimed→running→done/error/rejected`) + `result`/`exit_code`,
  by polling `GET /api/commands` every few seconds while the panel is open.
- Unauthenticated users see NONE of this — no dispatch UI, no command history. Confirm the anon
  client cannot read `fleet_commands` at all.

## Acceptance (validate, then STOP and report)
1. `npm run build` green.
2. Unauthed: `POST /api/command` and `GET /api/commands` → 401; dispatch UI unreachable; anon cannot
   read `fleet_commands`. Confirm explicitly.
3. Authed: submitting `verb:"check"` for a machine inserts a `pending` row; the panel shows the status
   transitions + result (end-to-end with the P2 agent running, or simulate the agent's result via the
   commands function). Off-allowlist verbs rejected both client- and server-side.
4. The allowlist is a single shared source of truth (imported by both the route and, conceptually,
   matching the agent's). Report real vs. stubbed.

Do not begin until I confirm.
