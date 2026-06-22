#!/usr/bin/env bash
#
# setup-fleet-p1-wave.sh — stage the 2 parallel Fleet P1 build sessions (run on the MAC).
#
#   P1-A  index.mjs  reporter: emit per-generation metric points  (feat/fleet-p1-reporter-metrics)
#   P1-B  web/       dashboard: fitness sparkline + authed logs    (feat/fleet-p1-dashboard)
#
# Independent (reporter at root vs web/), so they run in PARALLEL on separate branches/worktrees.
# Opens a Terminal tab per session, launches claude, PASTES the directive unsent (you review +
# press Return). Same conventions as setup-fleet-p0-wave1.sh.
#
# Run from the fleet-mission-control repo root on the Mac:  bash setup-fleet-p1-wave.sh
# Prereq: `claude` on PATH; Terminal granted Accessibility for the auto-paste.

set -euo pipefail

FLEET="$(pwd)"
FLEET_WT="$(cd .. && pwd)/fleet-wt"
CONV="prompts/PROMPT_fleet_conventions.md"

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo "ERROR: run from the fleet repo root."; exit 1; }
[ -f "$CONV" ] || { echo "ERROR: $CONV missing — run from the fleet repo root."; exit 1; }
[ -f "prompts/PROMPT_fleet_p1_reporter_metrics.md" ] || { echo "ERROR: P1-A prompt missing."; exit 1; }
[ -f "prompts/PROMPT_fleet_p1_dashboard.md" ] || { echo "ERROR: P1-B prompt missing."; exit 1; }
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

echo "Staging Fleet P1 wave (2 parallel sessions)…"

add_worktree "$FLEET_WT/p1-reporter" "feat/fleet-p1-reporter-metrics"
seed_fleet_wt "$FLEET_WT/p1-reporter"
open_session "$FLEET_WT/p1-reporter" \
  "Read ./prompts/PROMPT_fleet_conventions.md then ./prompts/PROMPT_fleet_p1_reporter_metrics.md and implement it exactly on this branch (feat/fleet-p1-reporter-metrics). Validation-first: --dry-run shows metrics, --once lands idempotent rows in fleet_job_metrics, --import-log backfills a finished run, then STOP and report. Do not begin until I confirm."

add_worktree "$FLEET_WT/p1-dashboard" "feat/fleet-p1-dashboard"
seed_fleet_wt "$FLEET_WT/p1-dashboard"
open_session "$FLEET_WT/p1-dashboard" \
  "Read ./prompts/PROMPT_fleet_conventions.md then ./prompts/PROMPT_fleet_p1_dashboard.md and implement it exactly on this branch (feat/fleet-p1-dashboard). Validation-first: npm run build green, sparkline updates live from fleet_job_metrics, authed /api/job/[id]/log returns 401 without cookie and log lines with it, public never leaks log_tail, 390px verified. Then STOP and report. Do not begin until I confirm."

cat <<DONE

Two tabs staged (P1-A reporter, P1-B dashboard). Each directive is PASTED but NOT submitted —
review and press Return.

Worktrees:
  $FLEET_WT/p1-reporter    (feat/fleet-p1-reporter-metrics)
  $FLEET_WT/p1-dashboard   (feat/fleet-p1-dashboard)

When both land: commit each branch, then we consolidate + the dashboard auto-deploys (Vercel).
DONE
