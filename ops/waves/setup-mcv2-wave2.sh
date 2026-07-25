#!/usr/bin/env bash
#
# setup-mcv2-wave2.sh — stage Mission Control v2, wave 2 (run on the MAC).
#
# Plan: docs/V2_PLAN.md milestone ladder + wave-1 close-out backlog. ONE stage,
# 2 parallel sessions (disjoint files):
#
#   waves-board  M3    feat/mcv2-waves-board  sonnet  (cockpit/ only)
#   hardening    infra feat/mcv2-hardening    sonnet  (deploy/hooks, ops/, supabase/ PROPOSE, docs/)
#
# NEW vs wave 1: this launcher REGISTERS THE WAVE ON THE BUS at dispatch via
# ops/bin/fleet-register-wave.mjs — sessions exist as `planned` work items in the
# cockpit before they run. (Registration is fail-soft: a bus hiccup warns, never
# blocks dispatch. Note: until this wave's own hook fix merges, completion records
# from worktrees still carry the worktree-dirname project and won't auto-enrich the
# registered rows — the planner reconciles at consolidation, as in wave 1.)
#
# Run from the fleet-mission-control repo root on the Mac:
#   bash ops/waves/setup-mcv2-wave2.sh

set -euo pipefail

FLEET="$(pwd)"
FLEET_WT="$(cd .. && pwd)/fleet-wt"
CONV="ops/prompts/PROMPT_fleet_conventions.md"

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo "ERROR: run from the fleet repo root."; exit 1; }
[ -f "$CONV" ] || { echo "ERROR: $CONV missing."; exit 1; }
[ -f "docs/SCHEMA_V2.md" ] || { echo "ERROR: docs/SCHEMA_V2.md missing — is main up to date?"; exit 1; }
command -v claude >/dev/null 2>&1 || { echo "ERROR: 'claude' CLI not on PATH."; exit 1; }
command -v node   >/dev/null 2>&1 || { echo "ERROR: 'node' not on PATH (needed for wave registration)."; exit 1; }

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
  local dir="$1" model="$2" directive="$3"
  osascript <<OSA
tell application "Terminal"
  activate
  do script "cd '$dir' && claude --model $model --permission-mode bypassPermissions"
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

# ── Register the wave on the bus (fail-soft) ──────────────────────────────────
register_wave () {
  # FLEET_TOKEN from the machine's gitignored env (reporter token).
  local token=""
  for f in "$FLEET/.env" "$FLEET/.fleet-secrets.env"; do
    [ -f "$f" ] || continue
    token="$(grep -m1 '^FLEET_TOKEN=' "$f" 2>/dev/null | cut -d= -f2-)"
    [ -n "$token" ] && break
  done
  if [ -z "$token" ]; then
    echo "WARN: FLEET_TOKEN not found in .env/.fleet-secrets.env — skipping wave registration."
    return 0
  fi
  local manifest
  manifest="$(mktemp)"
  cat >"$manifest" <<'JSON'
{
  "project": "fleet-mission-control",
  "wave": {
    "name": "mcv2-wave2",
    "status": "dispatched",
    "notes": "MCv2 wave 2: M3 waves board + inbox polish (chunk A) and pipeline hardening: hook project fix, staleness sweeper, launcher self-registration (chunk B)."
  },
  "sessions": [
    { "name": "mcv2-waves-board", "machine": "mac-cockpit",
      "repo": "vishal-h-pathak/fleet-mission-control", "branch": "feat/mcv2-waves-board",
      "worktree": "../fleet-wt/mcv2-waves-board", "model": "sonnet",
      "prompt_ref": "ops/prompts/PROMPT_mcv2_waves_board.md" },
    { "name": "mcv2-hardening", "machine": "mac-cockpit",
      "repo": "vishal-h-pathak/fleet-mission-control", "branch": "feat/mcv2-hardening",
      "worktree": "../fleet-wt/mcv2-hardening", "model": "sonnet",
      "prompt_ref": "ops/prompts/PROMPT_mcv2_hardening.md" }
  ]
}
JSON
  if FLEET_TOKEN="$token" node ops/bin/fleet-register-wave.mjs --manifest "$manifest"; then
    echo "  wave registered on the bus."
  else
    echo "WARN: wave registration failed — dispatching anyway (planner reconciles)."
  fi
  rm -f "$manifest"
}

require_prompt PROMPT_mcv2_waves_board.md
require_prompt PROMPT_mcv2_hardening.md

echo "Staging Mission Control v2 — wave 2"
register_wave

add_worktree "$FLEET_WT/mcv2-waves-board" "feat/mcv2-waves-board"
seed_fleet_wt "$FLEET_WT/mcv2-waves-board"
open_session "$FLEET_WT/mcv2-waves-board" sonnet \
  "Read ./ops/prompts/PROMPT_fleet_conventions.md then ./ops/prompts/PROMPT_mcv2_waves_board.md and implement it on this branch (feat/mcv2-waves-board). Build the /waves board (project->wave grouping, planned rows first-class, status chips, PR + /rc deep links, one-line machine rail) plus the Inbox polish: Dismiss action (contract: fleet_decisions action 'dismissed' -> session reviewed; may 400 until the sibling's migration is applied — expected), decision routes bump updated_at, middleware->proxy migration. cockpit/ only; do NOT edit docs/SCHEMA_V2.md. Validate against the live bus, then STOP and report. Do not begin until I confirm."

add_worktree "$FLEET_WT/mcv2-hardening" "feat/mcv2-hardening"
seed_fleet_wt "$FLEET_WT/mcv2-hardening"
open_session "$FLEET_WT/mcv2-hardening" sonnet \
  "Read ./ops/prompts/PROMPT_fleet_conventions.md then ./ops/prompts/PROMPT_mcv2_hardening.md and implement it on this branch (feat/mcv2-hardening). Three fixes found operating wave 1: (1) hook derives project from the origin remote URL basename, not the worktree dirname — live-validate; (2) PROPOSE-only migration adding 'lost' status + pg_cron staleness sweeper (guardrails in the prompt) and 'dismissed' decision action, with ingest updates on-branch and SCHEMA_V2.md contract updates — you own the doc this wave; (3) ops/waves/lib-register.sh reusable self-registration helper, demonstrated live with a throwaway mcv2-selftest wave. Validate, then STOP and report — the planner applies migrations. Do not begin until I confirm."

cat <<DONE

MCv2 wave 2 staged (2 parallel: waves-board M3 sonnet, hardening sonnet). Directives
pasted, not submitted — review + Return in each. The wave is registered on the bus, so
both sessions should appear as 'planned' in the cockpit's /waves view (once M3 lands)
and enrich as they run. When both report: consolidate, planner applies the proposed
migrations + deploys ingest, then the Dismiss path gets its live validation.
DONE
