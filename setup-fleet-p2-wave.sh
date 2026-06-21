#!/usr/bin/env bash
#
# setup-fleet-p2-wave.sh — stage the 2 Fleet P2 (control plane) build sessions (run on the MAC).
#
#   P2-A  agent/  control agent (per machine, allowlisted verbs)   (feat/fleet-p2-agent)
#   P2-B  web/    authed command dispatch UI + /api/command        (feat/fleet-p2-dashboard-dispatch)
#
# PREREQ: the planner must apply the `fleet_commands` schema FIRST (this is the security-sensitive
# surface). Do not run this wave until P1 is gauged and the planner confirms the schema is live.
#
# Run from the fleet-mission-control repo root on the Mac:  bash setup-fleet-p2-wave.sh

set -euo pipefail

FLEET="$(pwd)"
FLEET_WT="$(cd .. && pwd)/fleet-wt"
CONV="prompts/PROMPT_fleet_conventions.md"

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo "ERROR: run from the fleet repo root."; exit 1; }
[ -f "$CONV" ] || { echo "ERROR: $CONV missing."; exit 1; }
[ -f "prompts/PROMPT_fleet_p2_control_agent.md" ] || { echo "ERROR: P2-A prompt missing."; exit 1; }
[ -f "prompts/PROMPT_fleet_p2_dashboard_dispatch.md" ] || { echo "ERROR: P2-B prompt missing."; exit 1; }
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
  if git show-ref --verify --quiet "refs/heads/$branch"; then
    git worktree add "$wt" "$branch"
  else
    git worktree add -b "$branch" "$wt"
  fi
}

open_session () {
  local dir="$1" directive="$2"
  osascript <<OSA
tell application "Terminal"
  activate
  tell application "System Events" to keystroke "t" using command down
  delay 0.5
  do script "cd '$dir' && claude --permission-mode bypassPermissions" in front window
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

echo "Staging Fleet P2 wave (control plane — 2 sessions)…"

add_worktree "$FLEET_WT/p2-agent" "feat/fleet-p2-agent"
seed_fleet_wt "$FLEET_WT/p2-agent"
open_session "$FLEET_WT/p2-agent" \
  "Read ./prompts/PROMPT_fleet_conventions.md then ./prompts/PROMPT_fleet_p2_control_agent.md and implement it exactly on this branch (feat/fleet-p2-agent). This is the security-critical surface: hard-coded verb allowlist, validated/escaped args, NEVER arbitrary shell. Validation-first, then STOP and report. Do not begin until I confirm."

add_worktree "$FLEET_WT/p2-dashboard" "feat/fleet-p2-dashboard-dispatch"
seed_fleet_wt "$FLEET_WT/p2-dashboard"
open_session "$FLEET_WT/p2-dashboard" \
  "Read ./prompts/PROMPT_fleet_conventions.md then ./prompts/PROMPT_fleet_p2_dashboard_dispatch.md and implement it exactly on this branch (feat/fleet-p2-dashboard-dispatch). Everything authed; public surface unchanged; allowlist shared with the agent. Validation-first, then STOP and report. Do not begin until I confirm."

cat <<DONE

Two tabs staged (P2-A agent, P2-B dispatch). Directives PASTED, not submitted — review + Return.
Worktrees: $FLEET_WT/p2-agent , $FLEET_WT/p2-dashboard
DONE
