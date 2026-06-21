# P2-A — Control agent (per machine)

> PHASE 2. Do not start until the planner has applied the `fleet_commands` schema and confirmed.
Read `prompts/PROMPT_fleet_conventions.md` first. Branch: `feat/fleet-p2-agent`. Folder: `agent/`
(a new sibling to the reporter; may share helpers with `index.mjs` but is its own entrypoint).

## Goal
A per-machine agent that turns allowlisted commands in the bus into real work via `cockpit.sh`,
and writes results back. This is the security-critical surface — treat it as such.

## Planned schema (applied by the planner before you start; build to it, don't change it)
`public.fleet_commands`: `id, machine_id, verb, args jsonb, status
(pending|claimed|running|done|error|rejected), requested_by, created_at, claimed_at,
finished_at, result jsonb, exit_code`. No anon access; the agent uses a service-role key from env.

## What to build
- **Subscribe** (Supabase realtime) to `fleet_commands` for THIS machine where `status='pending'`;
  also poll every N s as a safety net. Claim a row atomically (`update … set status='claimed'
  where id=? and status='pending'`) so two agents never double-run it.
- **Verb allowlist — hard-coded, no exceptions.** Map each verb to a specific `cockpit.sh`
  invocation with validated/escaped args. Start with read-only/safe verbs:
  `check`, `status`, `fetch-log` (→ `cockpit.sh fetch`/`peek`), `pull`, `artifact <relpath>`.
  Reject anything not in the map with `status='rejected'`. NEVER pass args through a shell unescaped;
  NEVER construct a command from free text. No `run`/`start` verbs in the first cut — add them only
  behind an explicit, reviewed allowlist entry later.
- **Execute + report:** set `running`, run the mapped command (capture stdout/stderr/exit code),
  write `result` (truncated/sanitized) + `exit_code` + `finished_at` + `status` (`done`/`error`).
- Config via env: `FLEET_TOKEN` (machine id resolution if needed), `SUPABASE_URL`,
  `SUPABASE_SERVICE_ROLE_KEY` (server-only, on the machine), `COCKPIT_SH` path. Document in README.
- Runs on the Mac (data-pull verbs: `pull`, `fetch-log`, `artifact`) and on `sentry`. Provide
  launchd + systemd units like the reporter.

## Acceptance (validate, then STOP and report)
1. With a hand-inserted `pending` command (`verb:"check"`) for this machine, the agent claims,
   runs, and writes `status:"done"` + result. Two agents don't double-run (claim is atomic).
2. An unknown verb → `status:"rejected"`, nothing executed.
3. Args are validated/escaped — demonstrate that a hostile `args` value cannot inject a shell command.
4. No arbitrary-shell path exists anywhere. README documents the allowlist. Report real vs. stubbed.

Do not begin until I confirm.
