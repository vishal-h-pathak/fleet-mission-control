# Cowork kickoff — PLAN the Fleet "control loop" features (paste into a fresh Cowork session)

You're starting a fresh Cowork session to **plan (not yet implement)** a cluster of Fleet Mission
Control features that close the loop between **Cowork** (planning/delegation) and **Claude Code**
(execution), especially for delegated sessions on the **`sentry`** workstation. Keep the *cellular-gaits*
science work out of scope — this is purely the fleet/control-plane tooling. Both repos are mounted:
`fleet-mission-control` (the control plane: Supabase bus + Node reporter + agent + Next.js dashboard)
and `portfolio` (which holds `cockpit.sh`, the cross-machine driver, + `ops/render-stream.py`).

## Read first (you'll be caught up)
- `fleet-mission-control/docs/LOOP_CLOSER.md` — the run-finished notification design **and** the
  interactive-dispatch (`cg runi`) need, with the research (Claude Code hooks, ntfy/Tailscale, `/rc`).
- `fleet-mission-control/docs/ROADMAP.md` (Phase D items), `docs/BRIEF.md`, `docs/HOW_IT_WORKS.md`.
- `portfolio/cockpit.sh` — existing verbs (`run`, `run-b64`, `run-v`+`peekv` [uncommitted], `attach`,
  `artifact`, `wait`, `pull`, …) and `portfolio/ops/render-stream.py` (the parked stream renderer).

## The problem (why this exists)
Cowork plans + delegates; Claude Code executes — local on the Mac, and **delegated headless on sentry
via `cockpit.sh run` (`claude -p` in tmux)**. The loop is closed by hand and is fragile:
- **No mid-run control:** headless `claude -p` can't be observed, steered, or resumed. A session
  designed to "STOP and report, then we confirm the full run" can't be *continued* in-context — each
  step is a fresh dispatch that re-reads everything, and `cg attach` finds nothing to attach to.
- **No completion signal:** nothing tells the human (or Cowork) when a session finishes; you babysit
  the terminal and copy-paste results back.

## Features to plan (the scope)
1. **Interactive delegated dispatch — `cg runi`** (cockpit verb): interactive `claude` in tmux on the
   box (not `-p`, `--rc` on), directive seeded base-64-safe; steer via `cg attach` (ssh) or `/rc`
   (phone); pauses at STOP points for an in-session go/no-go. Reserve `-p` for autonomous jobs.
2. **Run-finished notifications (the loop-closer)** — per `LOOP_CLOSER.md`: Claude Code
   `Stop`/`SessionEnd` hooks (once per machine, fire in headless + interactive) → push to the human
   (ntfy-over-Tailscale) **and** write a completion record into the **fleet Supabase bus** (carrying
   `last_assistant_message` + the `/rc` link); **Cowork ingests by reading the bus via the Supabase
   MCP** (it can't be pushed to). Reuse the reporter's existing finished-job detection as the backstop.
3. **Streaming dispatch — `run-v`/`peekv`** (already drafted in `cockpit.sh` + `ops/render-stream.py`,
   uncommitted/untested): verbose `stream-json` dispatch + Mac-side renderer for live play-by-play.
   Validate against the live box, then commit.
4. **Box-session git reliability** — delegated sessions must **commit before the STOP** (a prompt
   ordering bug stranded work on 2026-06-22) and have working push creds, so artifacts sync back
   without manual `cg artifact` ferrying.

## Constraints / what already exists
- **Cowork has no SSH to the box and cannot be "pushed to"** — it only reads (mounted repos + the
  Supabase bus via the Supabase MCP). Any notification-to-Cowork is a *read*, not a push.
- Machines are behind **Tailscale** (no public inbound); **Supabase** is the push bus; **`/rc`** (on
  Max) is the depth/steering layer — do not rebuild it; **`cockpit.sh`** is the executor.
- The reporter already detects finished jobs (tmux disappears → `status:"finished"` → `fleet_jobs`).
- **Operating model:** plan in chat → tailor self-contained `PROMPT_*.md` per Claude Code session under
  `ops/prompts/` → a wave launcher under `ops/waves/`. Validation-first; STOP-and-report gates;
  commit-on-branch-before-finish; don't merge unless told.

## Your task THIS session = PLAN (do not implement)
Produce an implementation plan: sequence the four features and their dependencies (e.g. `cg runi` +
`/rc` unblock interactive steering; hooks + the bus enable notifications; `run-v` is the observe-only
sibling of `runi`), flag the open decisions (notification channel; build-vs-adopt for the hooks —
`claude-notifications-go`/`code-notify`; `cg runi` directive-seeding; a `fleet_events` table vs reusing
`ingest`, with the public/private split per `SCHEMA.md`), and break it into CC-session-sized prompts +
a wave under `ops/`. Bring the plan back for review before writing any prompts.
