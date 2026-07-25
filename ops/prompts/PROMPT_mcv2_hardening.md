# MCv2 — Pipeline hardening: hook project fix, staleness sweeper, launcher self-registration (wave 2, chunk B)

> MISSION CONTROL v2, wave 2. Read `ops/prompts/PROMPT_fleet_conventions.md` first, then
> `docs/V2_PLAN.md` and `docs/SCHEMA_V2.md`. Branch: `feat/mcv2-hardening`. Scope:
> `deploy/hooks/`, `ops/bin/`, `ops/waves/` (new helper only — don't rewrite existing
> launchers), `supabase/migrations/` (**PROPOSE only**), `docs/`. No `cockpit/`, no
> `web/`, no `agent/`. You own `docs/SCHEMA_V2.md` this wave; the sibling
> `waves-board` session builds UI to the contract you write.

Three defects/gaps found operating wave 1 live, plus one workflow upgrade:

## 1. Hook: canonical `project` (defect, confirmed live)
`fleet-notify.sh` derives `project` from the git toplevel's directory basename — in a
worktree that's the worktree dir (`mcv2-inbox`), not the repo name, so ingest's
(machine, project, branch) fallback rung can never match a registered session. Fix:
derive `project` from the `origin` remote URL's repo basename (strip `.git`; handle ssh
+ https forms), falling back to the current behavior when there's no remote. Keep it
zero-dep and fail-soft. Live-validate from a real worktree (show the POST body's project
now says the repo name) and re-run the wave-1 skip-path checks (main-branch skip,
gh-missing skip) to prove no regression.

## 2. Staleness sweeper (gap, confirmed live: abrupt session close ⇒ no SessionEnd, ever)
A Terminal/GUI Code session killed abruptly never reports; its `fleet_sessions` row sits
`running`/`planned` forever and the reporter's tmux backstop doesn't cover it. PROPOSE
(do not apply):
- Migration adding `'lost'` to the `fleet_sessions.status` check, and a `pg_cron` job
  (house style: `fleet_prune_heartbeats`) that flips **non-terminal** rows to `lost`
  when demonstrably stale — your call on exact predicates, but the guardrails are hard:
  never touch `done` or operator-terminal rows; `running` requires no matching live
  `fleet_jobs` row AND a generous updated_at horizon (≥12h); `planned` a longer one
  (≥48h from dispatched_at). `lost` is telemetry-terminal like `done` (a later real
  record for the same (machine,name) must start a fresh session, and a genuine late
  hook/backstop record matching by job_id may still flip `lost` → `done`); ingest v5
  code updates accordingly (branch only, not deployed).
- Same migration (or a sibling): add `'dismissed'` to the `fleet_decisions.action`
  check — the cockpit's noise-dismiss action (sibling session builds the UI; decision →
  session `reviewed`).
- Update `docs/SCHEMA_V2.md`: `lost` semantics + sweep predicates, `dismissed` action,
  and extend the status-transition table. Extend the existing ingest test file for the
  lost/fresh-session and late-record cases.

## 3. Launcher self-registration (workflow upgrade)
`ops/waves/lib-register.sh` — a small sourceable helper for wave launchers: given
project, wave name, and per-session (name, branch, machine, model, prompt_ref,
worktree), it builds the manifest JSON and calls `node ops/bin/fleet-register-wave.mjs
--manifest <tmpfile>` with `FLEET_TOKEN` sourced from the repo's gitignored env
(`.env` / `.fleet-secrets.env`), printing the returned ids; fail-soft (a registration
failure must warn, never abort a dispatch). Add a usage block to `ops/README.md` showing
a `setup-*.sh` integrating it. Note: `ops/waves/setup-mcv2-wave2.sh` (committed by the
planner) already inlines this pattern — extract/align with it rather than inventing a
second shape, and leave that file itself alone.

## Acceptance (validate, then STOP and report)
1. Hook fix live-validated per §1, shellcheck clean.
2. Migrations complete + lint-reasoned (not applied); ingest changes typecheck; extended
   tests pass; the lost/fresh/late race cases walked explicitly in your report.
3. `lib-register.sh` demonstrated with `--dry-run` (payload shown) and a real
   registration against the live bus of a throwaway wave named `mcv2-selftest` (status
   `draft`, 1 session named `selftest-noop`) — report the returned ids so the planner
   can clean it up.
4. `docs/SCHEMA_V2.md` updated; report the exact new transition-table rows.

> Before you STOP and report, in this exact order — never STOP dirty:
> 1. `git add -A && git commit -m "<clear message>"` on your branch.
> 2. `git push -u origin <branch>` — if push fails, run `cg artifact <path>` as the fallback and note it.
> 3. Only now STOP and report: **branch**, **commit SHA**, and **push result**. Don't merge.

Do not begin until I confirm.
