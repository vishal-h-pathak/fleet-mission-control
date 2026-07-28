# MCv2 wave 4 — dispatch hardening: gate removal, env sanitization, /rc pipeline, reporter classification, register idempotency

> Read `ops/prompts/PROMPT_fleet_conventions.md`, then `docs/V2_PLAN.md` and
> `docs/SCHEMA_V2.md` (M4 dispatch section). All five items below were found by the
> FIRST REAL cockpit dispatch (wave `mcv2-guide`, 2026-07-28) — this is live-fire
> feedback, not speculation. Scope: `agent/**`, the reporter (`index.mjs`, repo root),
> `supabase/functions/ingest/**` (code on branch — planner deploys),
> `cockpit/lib/compose/directive.mjs` + its test ONLY (nothing else in cockpit/),
> `scripts/check-allowlist-parity.mjs`, `docs/SCHEMA_V2.md` (you own it this wave).
> The sibling `cockpit-flow` session owns the rest of cockpit/ and `docs/V2_PLAN.md`.

## 1. Remove the per-session STOP gate for cockpit dispatches (operator decision, on record)
The Compose confirm-preview IS the human gate: the operator saw the exact directive and
typed the wave name to arm it. The launched session waiting again for "confirmed, go"
re-imports the friction M4 removed. Change `composeDirective()`'s template: the session
begins work immediately on launch; it still ends with the conventions STOP (commit →
push → STOP and report; never merge). Update `cockpit/lib/compose/directive.mjs` in the
same commit so the byte-parity test passes — these two files move together or not at all.
Document the gate-layering rationale in SCHEMA_V2's dispatch section.

## 2. Sanitize the launch environment (security defect, bit us live)
A stale `CLAUDE_CODE_OAUTH_TOKEN` leaked into the launchd GUI domain was inherited
agent → tmux → claude and overrode the operator's login (401 loop). Spawned sessions
must receive an explicit ALLOWLIST environment (PATH as configured, HOME, USER, SHELL,
TMPDIR, TERM, LANG/LC_* — justify each entry in a comment), never a pass-through.
Add a test asserting that poisoned vars (`CLAUDE_CODE_OAUTH_TOKEN`,
`ANTHROPIC_API_KEY`, `SUPABASE_*`, `FLEET_TOKEN` itself) present in the agent's own
environment do NOT reach the spawned command's env. Applies to every spawn in the
launch path (git, tmux, claude), not just the final one.

## 3. Fix the /rc sidecar → bus pipeline (broken live: mcv2-guide never got an rc_url)
No `.rc` sidecar was written for either launch of `mcv2-guide`. Diagnose from real
evidence (`~/cockpit-logs/`, the agent's service log, the running session if still up)
— do not guess. Fix whatever is broken in the resident wave loop's rc watcher, then
live-validate end to end: a launched session's /rc URL lands in the sidecar, the
reporter ships it, and `fleet_sessions.rc_url` is non-null on the bus. If you need a
live claude session to produce a real /rc URL, coordinate: the planner can re-arm a
drill wave — request it in a STOP rather than inventing one.

## 4. Reporter: classify launched sessions correctly (confirmed live: pane shows `node`)
`pane_current_command` reports `node` for claude sessions, so the wave-2 inferKind fix
never fires and launched sessions sit `planned` on the board until they finish. Detect
robustly: inspect the pane's process (e.g. `ps -o command= -p #{pane_pid}` or
pane_start_command) for claude, keep the existing checks as fallbacks, and pin it with
a test. Live-validate: a launched session flips `planned → running` on the board within
a reporter tick.

## 5. Ingest register block: reuse-not-duplicate waves (planner already applied the constraint)
The DB now enforces at most one ACTIVE wave per (project_id, name)
(`fleet_waves_active_name_uniq`, applied). Update the register block to match: a
registration naming an existing active wave REUSES it (refresh notes/dispatched_at,
re-register sessions idempotently as today; never reset wave lifecycle status), instead
of inserting a duplicate — and a unique-violation race falls back to the same reuse
path. Extend the register tests; update SCHEMA_V2's register section.

## Acceptance (then STOP and report)
1. All suites green: agent (incl. new env test), reporter test (create if none for the
   classifier), ingest tests, dispatch-logic, cockpit build+tests (directive parity!),
   allowlist parity.
2. Items 3 and 4 validated LIVE with bus evidence (rc_url non-null; planned→running
   observed), or an explicit STOP requesting the planner's drill wave if blocked.
3. Report the exact new directive template verbatim, the env allowlist verbatim, and
   the register reuse semantics.

> Before you STOP and report, in this exact order — never STOP dirty:
> 1. `git add -A && git commit -m "<clear message>"` on your branch.
> 2. `git push -u origin <branch>` — if push fails, note it and use `cg artifact`.
> 3. Only now STOP and report: **branch**, **commit SHA**, **push result**. Don't merge.
