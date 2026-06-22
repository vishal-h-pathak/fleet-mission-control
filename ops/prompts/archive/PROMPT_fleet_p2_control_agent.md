# P2-A — Control agent (per machine)

> PHASE 2. The `fleet_commands` schema + `commands` Edge Function are already applied/deployed.
Read `prompts/PROMPT_fleet_conventions.md` first. Branch: `feat/fleet-p2-agent`. Folder: `agent/`
(a new sibling to the reporter; may share small helpers with `index.mjs` but is its own entrypoint).

## Goal
A per-machine agent that turns allowlisted commands in the queue into real work via `cockpit.sh`,
and reports results back. This is the security-critical surface — treat it as such. Zero npm deps,
Node 18+, ESM, same style as the reporter.

## How it talks to the bus (NO service-role key on the machine)
The agent uses its existing per-machine token (`FLEET_TOKEN`) against the token-authed `commands`
Edge Function: `POST https://sbmsxerwgylpfkkkjtku.supabase.co/functions/v1/commands` with
`Authorization: Bearer $FLEET_TOKEN`. Actions (build to this contract exactly; don't change the DB
or the function — if you think they need changing, STOP and report):
- `{ "action": "claim" }` → `{ claimed: [ { id, verb, args, created_at } ] }` (atomically claims this
  machine's `pending` commands → `claimed`).
- `{ "action": "running", "id": "<cmd>" }` → marks it running.
- `{ "action": "result", "id": "<cmd>", "status": "done|error|rejected", "result"?, "exit_code"? }`.

Poll `claim` every few seconds (e.g. 3–5s; configurable). No realtime, no service-role — the function
is the only thing that touches the DB.

## Verb allowlist — hard-coded, no exceptions
Keep the allowlist in a single shared module (so the dashboard's dispatch route enforces the SAME
list — see P2-B). Start with read-only / safe verbs that map to existing `cockpit.sh` primitives:
- `check` → `cockpit.sh check`
- `status` → `cockpit.sh status`
- `fetch-log` (args: `{ name }`) → `cockpit.sh fetch` / `peek <name>`
- `pull` → `cockpit.sh pull`
- `artifact` (args: `{ relpath, dest? }`) → `cockpit.sh artifact <relpath> [dest]`
Reject any verb not in the map with `status:"rejected"`. **Validate/whitelist args** (e.g. `name`,
`relpath` must match a strict charset; no shell metacharacters). NEVER build a command from free text,
NEVER pass args through a shell unescaped, NEVER add a `run`/arbitrary-exec verb in this cut.

## Execute + report
On a claimed command: `running` → run the mapped `cockpit.sh` invocation (capture stdout/stderr/exit
code, truncate to a sane size) → `result` with `done`/`error` + `result` + `exit_code`. Note: on the
Mac, `cockpit.sh` drives sentry; data-pull verbs (`pull`, `fetch-log`, `artifact`) belong to the Mac
agent. Config via env: `FLEET_TOKEN`, `FLEET_COMMANDS_URL`, `COCKPIT_SH` path, poll interval. Provide
launchd + systemd units like the reporter. Document everything in `agent/README.md`.

## Acceptance (validate, then STOP and report)
1. With a hand-inserted `pending` command (I'll insert one, or you simulate via the function), the
   agent claims it, marks running, runs the mapped `cockpit.sh` verb, and reports `done` + result.
2. An unknown verb → `rejected`, nothing executed. Two agents don't double-run (claim is atomic).
3. Demonstrate a hostile `args` value cannot inject a shell command (show the validation/escaping).
4. No service-role key anywhere on the machine; no arbitrary-shell path exists. Report real vs. stubbed.

Do not begin until I confirm.
