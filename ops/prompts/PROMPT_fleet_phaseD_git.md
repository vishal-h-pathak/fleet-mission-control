# Phase D — Box-session git reliability (commit-before-STOP + push creds)

> PHASE D, feature F4. Read `ops/prompts/PROMPT_fleet_conventions.md` first. Branch:
> `feat/fleet-phaseD-git`. This is the **prerequisite** for the rest of Phase D (`runi`, `run-v`):
> a delegated session that STOPs with uncommitted work strands its artifacts. Small, mostly docs +
> a creds check. Touches fleet `docs/` + `ops/prompts/` AND `~/dev/jarvis/portfolio/cockpit.sh`
> (separate repo — commit there separately; it's a plain script, no secrets).

## Why (the bug)
On 2026-06-22 a delegated `sentry` session followed a prompt whose **"STOP and report" instruction
came BEFORE "commit your work"** — so it halted with uncommitted changes and the artifacts never
synced back; they had to be ferried manually with `cg artifact`. Two root causes: (1) prompt-template
ordering, and (2) no verified `git push` path from the box, so even committed work didn't reach
`origin`. Fix both so delegated artifacts sync by `git push`, with `cg artifact` as a fallback only.

## 1. Prompt-template ordering (fleet repo)
Make **commit-on-branch-before-the-STOP-gate** a frozen convention, not a per-prompt afterthought.
- In `ops/prompts/PROMPT_fleet_conventions.md`, under **Workflow**, add an explicit ordered rule:
  a delegated/STOP-gated session must, **before** it STOPs and reports, (a) stage + commit its work on
  its branch with a clear message, (b) `git push` that branch (creds permitting — see §2), and (c)
  only THEN STOP. "Report" includes the branch name + commit SHA + push result. Keep the existing
  "don't merge" rule.
- Add a short reusable **STOP-gate template block** (4–6 lines) other Phase D prompts can paste
  verbatim, encoding that order: `commit → push → STOP → report (branch, SHA, pushed?)`.
- Do NOT loosen any security rule; this is additive.

## 2. Box push creds (portfolio `cockpit.sh` + the box) — VERIFY, don't fabricate
The delegated session runs as `claude` in tmux on `sentry` (WSL). It must be able to `git push` the
repo it's working in (`cellular-gaits`, `portfolio`) to `origin`.
- Inspect how `cockpit.sh run`/`run-b64` set up the box working dir and git remote today. Determine
  whether `sentry` already has a working push credential (ssh deploy key or a token helper) for those
  repos. **Run a real probe** (e.g. `cg`-driven `git -C <repo> push --dry-run` on the box, or
  `ssh sentry 'cd <repo> && git push --dry-run'`). Report exactly what you find — do not assume.
- If push works: document the mechanism in `docs/HOW_IT_WORKS.md` (a "how delegated artifacts sync"
  note) so it's not tribal knowledge.
- If push does NOT work: add a tiny, reviewed `cockpit.sh` preflight (e.g. a `cg push-check <repo>`
  verb, or a check folded into `run`/`runi` startup) that reports whether the box can push, and
  **STOP and report** the exact credential fix needed (which key/token, where) — don't install
  secrets yourself.
- Keep `cg artifact` working as the fallback path; just demote it from primary to backup in the docs.

## Acceptance (validate, then STOP and report)
1. `PROMPT_fleet_conventions.md` states the commit→push→STOP order and carries the reusable STOP-gate
   block; no security rule weakened.
2. A concrete finding on box push creds for `cellular-gaits` + `portfolio`: works (with the mechanism
   documented) OR a precise, minimal fix named (and a preflight check added if you wrote one).
3. `cockpit.sh` changes (if any) are minimal, argv-array, `shell:false`-compatible, no `eval`; commit
   them in `~/dev/jarvis/portfolio` separately with a clear message.
4. Report: what changed in the fleet repo, what changed in portfolio, and the live push-probe result.

Do not begin until I confirm.
