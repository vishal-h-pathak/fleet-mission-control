# Phase C-B — Dashboard: new verbs + approval-gating UI

> PHASE C. Read `prompts/PROMPT_fleet_conventions.md` first. Branch: `feat/fleet-phaseC-dashboard`.
> Folder: `web/`. The `fleet_commands` schema has `awaiting_approval` + `approved_by`/`approved_at`.

## Goal
Surface the new action verbs (`morning`, `nav`, `run`) in the authed dispatch UI, and add an
**approval gate**: powerful verbs land as `awaiting_approval` and require an explicit second authed
action (Approve/Reject) before the agent can pick them up. Everything stays behind the auth cookie;
public surface unchanged.

## Shared allowlist (web/lib/commands/allowlist.mjs — keep byte-for-byte identical to agent/allowlist.mjs)
Add the new verbs with the SAME definitions the agent uses, including a `requiresApproval` flag per
verb: check/status/fetch-log/pull/artifact → false; `morning` → false; `nav` → true; `run` → true with
args `{ repo (fixed set: cellular-gaits|portfolio), directive (string, ≤2000 chars, no control chars) }`.
The parity test (`scripts/check-allowlist-parity.mjs`) must stay green — extend its vectors for the new
verbs (bad repo, over-long directive, nav/run no-arg/with-arg).

## Routes (server-only, service role, behind the existing auth cookie/middleware)
- `POST /api/command` — validate via the shared allowlist. If the verb's `requiresApproval` is true,
  insert with `status='awaiting_approval'`; else `status='pending'`. `requested_by` = the authed session.
- `POST /api/command/[id]/approve` — only an `awaiting_approval` row → set `status='pending'`,
  `approved_by` = session, `approved_at = now()`. (This is the gate that lets the agent claim it.)
- `POST /api/command/[id]/reject` — `awaiting_approval` (or pending) → `status='rejected'`.
- Add all three to `middleware.ts`. Mirror the existing authed-route pattern exactly.

## Dispatch UI (authed only)
- Verb picker now includes `morning` / `nav` / `run`. For `run`: a repo dropdown (the fixed set) + a
  directive textarea (length-counter, ≤2000). For `morning`/`nav`: no args.
- **Approval queue:** commands in `awaiting_approval` render with **Approve** / **Reject** buttons and
  show who requested + the verb/args (so you see exactly what you're approving — especially the `run`
  directive). After Approve, the row moves through `pending→claimed→running→done` like any other.
- Keep the existing polling lifecycle view (`fleet_commands` is deny-all + not realtime — poll the
  authed GET). Public surface still exposes none of this.

## Acceptance (validate, then STOP and report)
1. `npm run build` green; parity test green (new verbs included).
2. Unauthed: `/api/command`, `/api/command/[id]/approve`, `/reject` all 401; anon can't read
   `fleet_commands`. Confirm.
3. Authed: dispatching `run` (repo=cellular-gaits, a directive) inserts `awaiting_approval` (NOT
   pending); it shows in the approval queue with the directive visible; Approve flips it to `pending`
   (+ approved_by/at); Reject → `rejected`. `morning` goes straight to `pending`. Off-list verb / bad
   repo / over-long directive rejected client- and server-side.
4. Report real vs. stubbed.

Do not begin until I confirm.
