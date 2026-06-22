#!/usr/bin/env bash
#
# setup-fleet-phaseD-wave.sh — stage the Phase D "control loop" build sessions (run on the MAC).
#
# Phase D has ordered stages (see docs/CONTROL_LOOP_PLAN.md), so this launcher takes a STAGE arg:
#
#   git         F4 — box-session git reliability (prereq for everything).      1 session
#                 feat/fleet-phaseD-git   (fleet docs/prompts + ~/dev/jarvis/portfolio/cockpit.sh)
#
#   batch       Parallel batch — independent files, run concurrently.          3 sessions
#                 runv  F3  feat/fleet-phaseD-runv   (portfolio cockpit.sh + ops/render-stream.py)
#                 hook  F2a feat/fleet-phaseD-hook   (fleet deploy/ + machine hooks)
#                 bus   F2b feat/fleet-phaseD-bus    (fleet supabase/ + index.mjs)  [schema: PROPOSES, stops]
#
#   dependents  After 'batch' reports + consolidate — these depend on it.      2 sessions
#                 runi    F1  feat/fleet-phaseD-runi   (portfolio cockpit.sh)   depends on runv
#                 cowork  F2c feat/fleet-phaseD-cowork (fleet docs/ + query)    depends on bus
#
# Order to run:  git  →  (confirm, consolidate)  →  batch  →  (confirm, consolidate)  →  dependents.
# Each opens a Terminal window per session, claude running, directive PASTED-UNSENT (review, Return).
# The cockpit-touching sessions (git/runv/runi) must run on the Mac — that's where portfolio + the
# Tailscale path to sentry live.
#
# Run from the fleet-mission-control repo root on the Mac:
#   bash ops/waves/setup-fleet-phaseD-wave.sh git
#   bash ops/waves/setup-fleet-phaseD-wave.sh batch
#   bash ops/waves/setup-fleet-phaseD-wave.sh dependents

set -euo pipefail

STAGE="${1:-}"
case "$STAGE" in git|batch|dependents) ;; *)
  echo "usage: bash ops/waves/setup-fleet-phaseD-wave.sh {git|batch|dependents}"; exit 2 ;;
esac

FLEET="$(pwd)"
FLEET_WT="$(cd .. && pwd)/fleet-wt"
CONV="ops/prompts/PROMPT_fleet_conventions.md"

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo "ERROR: run from the fleet repo root."; exit 1; }
[ -f "$CONV" ] || { echo "ERROR: $CONV missing."; exit 1; }
command -v claude >/dev/null 2>&1 || { echo "ERROR: 'claude' CLI not on PATH."; exit 1; }

mkdir -p "$FLEET_WT"

seed_fleet_wt () {
  local wt="$1"
  mkdir -p "$wt/ops/prompts" "$wt/docs"
  cp "$FLEET"/ops/prompts/*.md "$wt/ops/prompts/" 2>/dev/null || true
  cp "$FLEET"/docs/*.md        "$wt/docs/"        2>/dev/null || true
  [ -f "$FLEET/.fleet-secrets.env" ] && cp "$FLEET/.fleet-secrets.env" "$wt/" 2>/dev/null || true
}
add_worktree () {
  local wt="$1" branch="$2"
  if [ -d "$wt" ]; then echo "  worktree $wt exists — reusing"; return; fi
  if git show-ref --verify --quiet "refs/heads/$branch"; then git worktree add "$wt" "$branch"; else git worktree add -b "$branch" "$wt"; fi
}
require_prompt () { [ -f "ops/prompts/$1" ] || { echo "ERROR: prompt ops/prompts/$1 missing."; exit 1; }; }
open_session () {
  local dir="$1" directive="$2"
  osascript <<OSA
tell application "Terminal"
  activate
  do script "cd '$dir' && claude --permission-mode bypassPermissions"
end tell
OSA
  sleep 4
  osascript <<OSA
set the clipboard to "$directive"
tell application "Terminal" to activate
delay 0.3
tell application "System Events" to keystroke "v" using command down
OSA
}

stage_git () {
  require_prompt PROMPT_fleet_phaseD_git.md
  add_worktree "$FLEET_WT/phaseD-git" "feat/fleet-phaseD-git"
  seed_fleet_wt "$FLEET_WT/phaseD-git"
  open_session "$FLEET_WT/phaseD-git" \
    "Read ./ops/prompts/PROMPT_fleet_conventions.md then ./ops/prompts/PROMPT_fleet_phaseD_git.md and implement it on this branch (feat/fleet-phaseD-git). Add the commit->push->STOP ordering + reusable STOP-gate block to conventions; verify/repair box git push creds for cellular-gaits + portfolio (probe live, don't assume), commit any cockpit.sh change in ~/dev/jarvis/portfolio separately. Validate, then STOP and report the live push-probe result. Do not begin until I confirm."
  cat <<DONE

Phase D / git (F4) staged at $FLEET_WT/phaseD-git (feat/fleet-phaseD-git). Directive pasted, not
submitted — review + Return. This is the prereq; consolidate it before running 'batch'.
DONE
}

stage_batch () {
  require_prompt PROMPT_fleet_phaseD_runv.md
  require_prompt PROMPT_fleet_phaseD_hook.md
  require_prompt PROMPT_fleet_phaseD_bus.md

  add_worktree "$FLEET_WT/phaseD-runv" "feat/fleet-phaseD-runv"
  seed_fleet_wt "$FLEET_WT/phaseD-runv"
  open_session "$FLEET_WT/phaseD-runv" \
    "Read ./ops/prompts/PROMPT_fleet_conventions.md then ./ops/prompts/PROMPT_fleet_phaseD_runv.md and implement it on this branch (feat/fleet-phaseD-runv). Validate the drafted run-v/peekv + ops/render-stream.py in ~/dev/jarvis/portfolio against the live sentry box, fix, commit there. Validate, then STOP and report a rendered sample + what runi can reuse. Do not begin until I confirm."

  add_worktree "$FLEET_WT/phaseD-hook" "feat/fleet-phaseD-hook"
  seed_fleet_wt "$FLEET_WT/phaseD-hook"
  open_session "$FLEET_WT/phaseD-hook" \
    "Read ./ops/prompts/PROMPT_fleet_conventions.md then ./ops/prompts/PROMPT_fleet_phaseD_hook.md and implement it on this branch (feat/fleet-phaseD-hook). Build a per-machine SessionEnd+Notification hook (own zero-dep script) that desktop+ntfy pushes AND POSTs a finished record (last_message + rc_url) to ingest with the machine token; install once-per-machine, fail-soft. Validate on the Mac, then STOP and report. Do not begin until I confirm."

  add_worktree "$FLEET_WT/phaseD-bus" "feat/fleet-phaseD-bus"
  seed_fleet_wt "$FLEET_WT/phaseD-bus"
  open_session "$FLEET_WT/phaseD-bus" \
    "Read ./ops/prompts/PROMPT_fleet_conventions.md then ./ops/prompts/PROMPT_fleet_phaseD_bus.md and implement it on this branch (feat/fleet-phaseD-bus). Add a single private last_message column (PROPOSE the migration, do NOT apply), accept last_message in ingest routing it to fleet_job_links, fix finished-row idempotency so hook+reporter converge on one row without nulling private fields; reporter stays backstop (no push, no clobber). Validate, then STOP and report — I apply the migration. Do not begin until I confirm."

  cat <<DONE

Phase D / batch staged (3 parallel: runv F3, hook F2a, bus F2b). Directives pasted, not submitted —
review + Return in each. NOTE: 'bus' is schema-touching — it PROPOSES a migration and stops; the
planner applies it. When all three report, consolidate (parity check runs), then run 'dependents'.
DONE
}

stage_dependents () {
  require_prompt PROMPT_fleet_phaseD_runi.md
  require_prompt PROMPT_fleet_phaseD_cowork.md

  add_worktree "$FLEET_WT/phaseD-runi" "feat/fleet-phaseD-runi"
  seed_fleet_wt "$FLEET_WT/phaseD-runi"
  open_session "$FLEET_WT/phaseD-runi" \
    "Read ./ops/prompts/PROMPT_fleet_conventions.md then ./ops/prompts/PROMPT_fleet_phaseD_runi.md and implement it on this branch (feat/fleet-phaseD-runi). Add cg runi to ~/dev/jarvis/portfolio/cockpit.sh: interactive claude (NOT -p), --rc + bypassPermissions, base64 send-keys seed-and-submit, pauses at the prompt STOP gate; cg attach + /rc both steer in-context; reuse runv's seeding/log path; leave run/run-b64/run-v untouched. Validate against the live box, then STOP and report. Do not begin until I confirm."

  add_worktree "$FLEET_WT/phaseD-cowork" "feat/fleet-phaseD-cowork"
  seed_fleet_wt "$FLEET_WT/phaseD-cowork"
  open_session "$FLEET_WT/phaseD-cowork" \
    "Read ./ops/prompts/PROMPT_fleet_conventions.md then ./ops/prompts/PROMPT_fleet_phaseD_cowork.md and implement it on this branch (feat/fleet-phaseD-cowork). Document the Cowork Supabase-MCP read pattern + a canonical query for recently-finished delegated jobs (public = it finished; authed/service-role = last_message + rc_url); note the one-global-scheduled-task option. Don't over-build. Validate against the live bus, then STOP and report. Do not begin until I confirm."

  cat <<DONE

Phase D / dependents staged (runi F1 [needs runv], cowork F2c [needs bus]). Directives pasted, not
submitted — review + Return. When they report, consolidate. That completes Phase D's control loop.
DONE
}

echo "Staging Fleet Phase D — stage: $STAGE"
case "$STAGE" in
  git)        stage_git ;;
  batch)      stage_batch ;;
  dependents) stage_dependents ;;
esac
