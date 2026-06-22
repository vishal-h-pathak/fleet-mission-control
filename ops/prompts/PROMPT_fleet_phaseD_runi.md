# Phase D — `cg runi` interactive delegated dispatch

> PHASE D, feature F1. Read `ops/prompts/PROMPT_fleet_conventions.md` first. Branch:
> `feat/fleet-phaseD-runi`. Works in `~/dev/jarvis/portfolio` (separate repo — commit there).
> **Depends on F3 (`run-v`/`peekv`)** being merged: reuse its proven `stream-json`/tmux seeding, log
> path, and session-naming. Pairs with Phase B (`/rc`) and the F4 git-reliability convention
> (commit→push→STOP). Follow the **STOP-gate template block** now in `PROMPT_fleet_conventions.md`.

## The gap this closes
`cockpit.sh run` dispatches **headless `claude -p`** on the box — which can't be observed mid-run,
steered, or resumed. A session designed to "STOP and report, then we confirm the full run" can't be
*continued* in-context: `-p` ends its turn, `cg attach` finds nothing, and each next step is a fresh
dispatch that re-reads everything. Headless is the wrong tool for STOP-and-confirm jobs.

## Goal — a new `cg runi <repo> "<directive>"` verb
Launch an **interactive** `claude` (NOT `-p`) in a tmux session on the box, leaving it live and
steerable, paused at the prompt's STOP gate for an in-session go/no-go that continues **in the same
session, with context**. Reserve `-p`/`run` for truly autonomous, no-confirmation jobs.

Specifics:
- Invoke interactive `claude` with `--rc` (remote control on, so Phase B surfaces its `/rc` URL) and
  `--permission-mode bypassPermissions`, in tmux + tee to the same `$RLOG/<name>.log` path `run`/
  `run-v` use. NO `-p`.
- **Directive seeding = seed-and-submit (decided).** Pass the directive **base64-encoded** like
  `run-b64`; decode on the box; `tmux send-keys -l` the decoded text into the live pane, then send
  `Enter`. The session runs autonomously **until its prompt's STOP gate** (the gate is the
  confirmation point — preserves "delegate and walk away"). Decode safely (`base64 -d`), never `eval`.
  Same validation as `run-b64`: length-capped, no control chars/NULs; repo from the fixed set.
- **Steering paths (verify both):**
  - `cg attach <name>` → attaches to the tmux session over ssh for full keyboard control (answer a
    prompt, type "launch the full run"). If `cg attach` doesn't already target the right session, fix
    it so it finds a `runi` session by name.
  - `/rc` → the URL printed by `--rc` lands in the log → reporter scrapes it (Phase B) → dashboard
    surfaces it → steer from phone/browser, in sync.
- **`/rc` capture (note the F3 finding):** `run-v`/`run-b64` validation (2026-06-22) showed headless
  `-p`/print mode **never emits a `/rc` steering URL** into the log — so this interactive `runi` verb
  should be the **first** dispatch where `/rc` actually works (remote-control bridges a *running
  interactive* session). Do NOT rely on log-scrape: have the STOP-gate / launch path **write the `.rc`
  sidecar explicitly via `--set-rc <name> <url>`** once the interactive session prints its URL, so the
  reporter surfaces it deterministically. Confirm it lands on the job card (Phase B) and steers the
  same session. If no URL appears even interactively, report that plainly (don't claim `/rc` works).

## Acceptance (validate, then STOP and report — live box)
1. `cg runi <repo> "<directive with quotes/spaces/punct>"` launches an interactive (non-`-p`) tmux
   session on `sentry`; the directive is seeded intact (decode round-trips) and submitted; the session
   runs and **pauses at the STOP gate** rather than ending its turn.
2. `cg attach <name>` drops into that live session with keyboard control; typing a follow-up
   ("proceed with the full run") continues it **in-context** (no re-read). Detach leaves it running.
3. The session's `/rc` URL surfaces on its job card (Phase B intact); tapping it steers the same
   session.
4. `run`/`run-b64`/`run-v` are untouched and still work. argv-array, `shell:false`-compatible, base64
   directive, no `eval`. Commit `cockpit.sh` in `~/dev/jarvis/portfolio` on a clear message; report SHA.
5. Report: live-tested vs. deferred; the exact `attach`/seeding commands; any race seen on `/rc` capture.

Do not begin until I confirm.
