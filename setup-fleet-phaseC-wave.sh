#!/usr/bin/env bash
#
# setup-fleet-phaseC-wave.sh — stage the 2 parallel Phase C build sessions (run on the MAC).
#
#   C-A  agent/ (+ ~/dev/jarvis/portfolio/cockpit.sh)  new verbs morning/nav/run + approval enforce
#        (feat/fleet-phaseC-agent)
#   C-B  web/   new verbs in dispatch UI + approval-gating (awaiting_approval → Approve/Reject)
#        (feat/fleet-phaseC-dashboard)
#
# The two MUST keep allowlist.mjs byte-identical (parity test guards it) — same verbs + requiresApproval
# flags + run arg schema. Independent files otherwise, so they run in parallel on separate branches.
# Opens a Terminal window per session, claude running, directive pasted-unsent (review, press Return).
#
# Run from the fleet-mission-control repo root on the Mac:  bash setup-fleet-phaseC-wave.sh

set -euo pipefail

FLEET="$(pwd)"
FLEET_WT="$(cd .. && pwd)/fleet-wt"
CONV="prompts/PROMPT_fleet_conventions.md"

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo "ERROR: run from the fleet repo root."; exit 1; }
[ -f "$CONV" ] || { echo "ERROR: $CONV missing."; exit 1; }
[ -f "prompts/PROMPT_fleet_phaseC_agent.md" ] || { echo "ERROR: C-A prompt missing."; exit 1; }
[ -f "prompts/PROMPT_fleet_phaseC_dashboard.md" ] || { echo "ERROR: C-B prompt missing."; exit 1; }
command -v claude >/dev/null 2>&1 || { echo "ERROR: 'claude' CLI not on PATH."; exit 1; }

mkdir -p "$FLEET_WT"

seed_fleet_wt () {
  local wt="$1"
  mkdir -p "$wt/prompts" "$wt/docs"
  cp "$FLEET"/prompts/*.md "$wt/prompts/" 2>/dev/null || true
  cp "$FLEET"/docs/*.md    "$wt/docs/"    2>/dev/null || true
  [ -f "$FLEET/.fleet-secrets.env" ] && cp "$FLEET/.fleet-secrets.env" "$wt/" 2>/dev/null || true
}
add_worktree () {
  local wt="$1" branch="$2"
  if [ -d "$wt" ]; then echo "  worktree $wt exists — reusing"; return; fi
  if git show-ref --verify --quiet "refs/heads/$branch"; then git worktree add "$wt" "$branch"; else git worktree add -b "$branch" "$wt"; fi
}
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

echo "Staging Fleet Phase C wave (2 parallel sessions)…"

add_worktree "$FLEET_WT/phaseC-agent" "feat/fleet-phaseC-agent"
seed_fleet_wt "$FLEET_WT/phaseC-agent"
open_session "$FLEET_WT/phaseC-agent" \
  "Read ./prompts/PROMPT_fleet_conventions.md then ./prompts/PROMPT_fleet_phaseC_agent.md and implement it on this branch (feat/fleet-phaseC-agent). Add verbs morning/nav/run with requiresApproval flags, the cockpit.sh run-b64 (--rc) change in ~/dev/jarvis/portfolio, and agent approval enforcement (refuse mutating verb without approved_at). Keep allowlist byte-identical to the dashboard copy. Validate, then STOP and report. Do not begin until I confirm."

add_worktree "$FLEET_WT/phaseC-dashboard" "feat/fleet-phaseC-dashboard"
seed_fleet_wt "$FLEET_WT/phaseC-dashboard"
open_session "$FLEET_WT/phaseC-dashboard" \
  "Read ./prompts/PROMPT_fleet_conventions.md then ./prompts/PROMPT_fleet_phaseC_dashboard.md and implement it on this branch (feat/fleet-phaseC-dashboard). Add morning/nav/run to the dispatch UI + the approval gate (awaiting_approval → Approve/Reject routes + queue). Keep allowlist byte-identical to the agent copy; parity test green. Validate, then STOP and report. Do not begin until I confirm."

cat <<DONE

Two tabs staged (C-A agent, C-B dashboard). Directives PASTED, not submitted — review + Return.
Worktrees: $FLEET_WT/phaseC-agent , $FLEET_WT/phaseC-dashboard
Remember: the two allowlist.mjs copies must stay byte-identical (parity test). When both report,
consolidate with the usual prompt (it runs the parity check).
DONE
