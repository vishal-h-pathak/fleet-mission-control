#!/usr/bin/env bash
#
# setup-fleet-phaseB-wave.sh — stage the single Phase B (/rc depth join) build session (run on the MAC).
# One session, one branch (feat/fleet-phaseB-rc) touching index.mjs + web/. Opens a Terminal window
# with claude running and the directive pasted-unsent (review, press Return).
#
# Run from the fleet-mission-control repo root on the Mac:  bash ops/waves/setup-fleet-phaseB-wave.sh

set -euo pipefail

FLEET="$(pwd)"
FLEET_WT="$(cd .. && pwd)/fleet-wt"
CONV="ops/prompts/PROMPT_fleet_conventions.md"

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo "ERROR: run from the fleet repo root."; exit 1; }
[ -f "$CONV" ] || { echo "ERROR: $CONV missing."; exit 1; }
[ -f "ops/prompts/PROMPT_fleet_phaseB_rc_join.md" ] || { echo "ERROR: Phase B prompt missing."; exit 1; }
command -v claude >/dev/null 2>&1 || { echo "ERROR: 'claude' CLI not on PATH."; exit 1; }

mkdir -p "$FLEET_WT"
wt="$FLEET_WT/phaseB-rc"; branch="feat/fleet-phaseB-rc"

if [ ! -d "$wt" ]; then
  if git show-ref --verify --quiet "refs/heads/$branch"; then git worktree add "$wt" "$branch"; else git worktree add -b "$branch" "$wt"; fi
else
  echo "worktree $wt exists — reusing"
fi
mkdir -p "$wt/prompts" "$wt/docs"
cp "$FLEET"/ops/prompts/*.md "$wt/ops/prompts/" 2>/dev/null || true
cp "$FLEET"/docs/*.md    "$wt/docs/"    2>/dev/null || true
[ -f "$FLEET/.fleet-secrets.env" ] && cp "$FLEET/.fleet-secrets.env" "$wt/" 2>/dev/null || true

osascript <<OSA
tell application "Terminal"
  activate
  do script "cd '$wt' && claude --permission-mode bypassPermissions"
end tell
OSA
sleep 4
DIRECTIVE="Read ./ops/prompts/PROMPT_fleet_conventions.md then ./ops/prompts/PROMPT_fleet_phaseB_rc_join.md and implement it on this branch (feat/fleet-phaseB-rc). Reporter: keep zero-dep, add /rc URL log-detection + --set-rc helper. Dashboard: confirm mobile tap-through + add an authed QR (small npm lib ok), public leaks nothing. Validate, then STOP and report the /rc regex you settled on. Do not begin until I confirm."
osascript <<OSA
set the clipboard to "$DIRECTIVE"
tell application "Terminal" to activate
delay 0.3
tell application "System Events" to keystroke "v" using command down
OSA

cat <<DONE

Phase B session staged at $wt (branch feat/fleet-phaseB-rc). Directive pasted, not submitted —
review and press Return. When it reports, consolidate with the usual consolidate prompt.
DONE
