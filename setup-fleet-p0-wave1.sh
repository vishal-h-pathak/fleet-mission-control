#!/usr/bin/env bash
#
# setup-fleet-p0-wave1.sh — stage the 3 parallel Fleet P0 wave-1 sessions.
#
#   F1  fleet-mission-control  reporter/ — standalone Node telemetry agent   (feat/fleet-p0-reporter)
#   F2  fleet-mission-control  web/      — realtime phone-responsive dashboard (feat/fleet-p0-dashboard)
#   F3  portfolio              nav link to the Fleet app                       (feat/fleet-portfolio-link)
#
# All three are independent (disjoint folders/repos) and run in PARALLEL. Each gets its own
# git worktree + branch so the sessions never collide. The script opens a Terminal tab per
# session, cd's in, launches claude, and PASTES the directive WITHOUT pressing Return — you
# review, then hit Return yourself. bypassPermissions: review before Return.
#
# Run from the fleet-mission-control repo root on the Mac:  bash setup-fleet-p0-wave1.sh
#
# Requirements:
#   - macOS + Terminal.app; grant Terminal Accessibility (System Settings > Privacy &
#     Security > Accessibility) for the auto-paste keystroke. If paste misfires, each
#     worktree has the prompt files — paste the directive by hand.
#   - `claude` CLI on PATH. The Supabase data layer is already live (see docs/SCHEMA.md).
#   - The reporter needs FLEET_TOKEN and the dashboard needs the service-role key at RUN time,
#     not build time — register machines / fill .env when each session asks.

set -euo pipefail

FLEET="$(pwd)"
PORTFOLIO="$HOME/dev/jarvis/portfolio"
FLEET_WT="$(cd .. && pwd)/fleet-wt"
PORT_WT="$(cd .. && pwd)/portfolio-wt"
CONV="prompts/PROMPT_fleet_conventions.md"

# --- preconditions ---
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo "ERROR: run from the fleet-mission-control repo root."; exit 1; }
[ -f "$CONV" ] || { echo "ERROR: $CONV not found — run from the fleet repo root."; exit 1; }
[ -f "prompts/PROMPT_fleet_reporter.md" ] || { echo "ERROR: reporter prompt missing."; exit 1; }
[ -f "prompts/PROMPT_fleet_dashboard.md" ] || { echo "ERROR: dashboard prompt missing."; exit 1; }
[ -f "prompts/PROMPT_fleet_portfolio_link.md" ] || { echo "ERROR: portfolio-link prompt missing."; exit 1; }
[ -d "$PORTFOLIO/.git" ] || { echo "ERROR: portfolio repo not found at $PORTFOLIO"; exit 1; }
command -v claude >/dev/null 2>&1 || { echo "ERROR: 'claude' CLI not on PATH."; exit 1; }

mkdir -p "$FLEET_WT" "$PORT_WT"

# open_session <dir> <setup-cmd> <directive>
open_session () {
  local dir="$1" setup="$2" directive="$3"
  osascript <<OSA
tell application "Terminal"
  activate
  tell application "System Events" to keystroke "t" using command down
  delay 0.5
  do script "cd '$dir' && $setup && claude --permission-mode bypassPermissions" in front window
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

# add_worktree <repo-dir> <worktree-path> <branch>  (branches off the repo's current HEAD)
add_worktree () {
  local repo="$1" wt="$2" branch="$3"
  if [ -d "$wt" ]; then echo "  worktree $wt exists — reusing"; return; fi
  if git -C "$repo" show-ref --verify --quiet "refs/heads/$branch"; then
    git -C "$repo" worktree add "$wt" "$branch"
  else
    git -C "$repo" worktree add -b "$branch" "$wt"
  fi
}

echo "Staging Fleet P0 wave-1 (3 parallel sessions)…"

# Ensure a fleet worktree has the prompts/docs even if they aren't committed yet.
seed_fleet_wt () {
  local wt="$1"
  mkdir -p "$wt/prompts" "$wt/docs"
  cp "$FLEET"/prompts/*.md "$wt/prompts/" 2>/dev/null || true
  cp "$FLEET"/docs/*.md    "$wt/docs/"    2>/dev/null || true
}

# ── F1 — reporter (fleet worktree) ──
add_worktree "$FLEET" "$FLEET_WT/reporter" "feat/fleet-p0-reporter"
seed_fleet_wt "$FLEET_WT/reporter"
open_session "$FLEET_WT/reporter" "true" \
  "Read ./prompts/PROMPT_fleet_conventions.md then ./prompts/PROMPT_fleet_reporter.md and implement the reporter exactly on this branch (feat/fleet-p0-reporter). Validation-first: build, run --dry-run, then --once against the live ingest, then STOP and report before finalizing. Do not begin until I confirm."

# ── F2 — dashboard (fleet worktree) ──
add_worktree "$FLEET" "$FLEET_WT/dashboard" "feat/fleet-p0-dashboard"
seed_fleet_wt "$FLEET_WT/dashboard"
open_session "$FLEET_WT/dashboard" "true" \
  "Read ./prompts/PROMPT_fleet_conventions.md then ./prompts/PROMPT_fleet_dashboard.md and implement the dashboard exactly on this branch (feat/fleet-p0-dashboard). Validation-first: npm run build green, verify realtime + the 390px mobile layout + the authed /rc links boundary, then STOP and report. Do not begin until I confirm."

# ── F3 — portfolio nav link (portfolio worktree; copy prompt in, wire deps) ──
add_worktree "$PORTFOLIO" "$PORT_WT/fleet-link" "feat/fleet-portfolio-link"
cp "$FLEET/prompts/PROMPT_fleet_portfolio_link.md" "$PORT_WT/fleet-link/" 2>/dev/null || true
[ -e "$PORT_WT/fleet-link/node_modules" ] || ln -s "$PORTFOLIO/node_modules" "$PORT_WT/fleet-link/node_modules" 2>/dev/null || true
[ -f "$PORTFOLIO/.env.local" ] && cp "$PORTFOLIO/.env.local" "$PORT_WT/fleet-link/.env.local" 2>/dev/null || true
open_session "$PORT_WT/fleet-link" "true" \
  "Read ~/dev/jarvis/fleet-mission-control/prompts/PROMPT_fleet_conventions.md then ./PROMPT_fleet_portfolio_link.md and implement it exactly on this branch (feat/fleet-portfolio-link). Keep portfolio build green. Do not begin until I confirm."

cat <<DONE

Three tabs staged (F1 reporter, F2 dashboard, F3 portfolio link). Each has its directive
PASTED but NOT submitted — review and press Return to start it.

Worktrees:
  $FLEET_WT/reporter     (feat/fleet-p0-reporter)
  $FLEET_WT/dashboard    (feat/fleet-p0-dashboard)
  $PORT_WT/fleet-link    (feat/fleet-portfolio-link)

When a session finishes: review the diff, commit on its branch, then we run wave 2
(verify end-to-end → deploy the dashboard to Vercel → merge).

Teardown for a worktree when done:
  git -C "$FLEET" worktree remove ../fleet-wt/reporter      # etc. (--force if needed)
  git -C "$PORTFOLIO" worktree remove ../portfolio-wt/fleet-link
DONE
