# Consolidate finished Fleet work into main

> Hand this to a fresh Claude Code session opened in `~/dev/jarvis/fleet-mission-control`.
> Reusable every phase. Tailor the "Extra instructions" line per round.

You are consolidating finished Fleet Mission Control work: merge completed feature branches into
`main` and push — using **judgment**. Inspect the real git state first, propose a short plan, then
execute with the safety rails below. Do not write or modify project code; this is a git task only.

## Scope
- The `fleet-mission-control` repo only (`github.com/vishal-h-pathak/fleet-mission-control`). The
  `portfolio` repo is separate — do not touch it unless I explicitly say so here.
- Default candidates: all local `feat/fleet-*` branches not yet merged into `main`.
- **Extra instructions (this round):** _<<< I'll fill this in, e.g. "merge feat/fleet-p1-reporter-metrics
  and feat/fleet-p1-dashboard; the dashboard branch is approved — commit it if its worktree is clean.">>>_

## 1. Inspect, then REPORT a plan (change nothing yet)
- `git worktree list`; for each relevant worktree: `git -C <wt> status -s` and `git -C <wt> log --oneline -1`.
- Candidate branches via `git branch --list 'feat/fleet-*'` with `--merged`/`--no-merged main`; show each
  branch's last commit + merged state.
- Flag: is the main worktree dirty (uncommitted scaffold/docs)? Is local `main` ahead/behind `origin/main`?
  Any branch with uncommitted work in its worktree?
- Output a concise plan: what you'll commit, which branches you'll merge and in what order, and anything
  that needs my decision. If anything is ambiguous or risky, STOP and ask before proceeding.

## 2. Execute (after presenting the plan)
- Clear stale locks only if no git process is running: `find .git -name '*.lock' -delete`.
- A feature branch with uncommitted work in its worktree: commit it on its branch with a clear message
  ONLY if I approved that branch (see Extra instructions); otherwise leave it and report it.
- Commit pending main-worktree changes (scaffold/docs) with a clear message.
- `git checkout main`; `git pull --ff-only`. If it can't fast-forward, STOP and report — `main` diverged;
  do not force or rebase without my say-so.
- Merge each approved branch with `--no-ff` and a clear message. On CONFLICT: `git merge --abort`, then
  report the conflicting files + a proposed resolution. Never resolve silently.
- `git push`.

## Safety rails (always)
- Never force-push, never rewrite history, never change remotes.
- Never stage secrets — `.env`, `.env.local`, `.fleet-secrets.env` are gitignored; run `git status` and
  confirm none are staged before any commit.
- If `git push` fails on auth, STOP and tell me (I'll supply a token).

## 2b. Parity guard (if both allowlists exist on main after merge)
If `agent/allowlist.mjs` and `web/lib/commands/allowlist.mjs` both exist, run
`node scripts/check-allowlist-parity.mjs`. If it prints `PARITY FAIL`, STOP and report the
divergences — the control agent and the dashboard must accept/reject the exact same inputs.

## 3. Report back
- Resulting `main` SHA + confirmation it's pushed.
- Which branches merged; anything skipped/left, and why.
- If `index.mjs` changed: remind me to `git pull` on sentry and restart the reporter.
- If `web/` changed: note the dashboard auto-deploys on Vercel.
