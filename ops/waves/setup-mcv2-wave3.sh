#!/usr/bin/env bash
#
# setup-mcv2-wave3.sh — stage Mission Control v2, wave 3: M4 phone dispatch (run on the MAC).
#
# THE SECURITY-CRITICAL WAVE. Design decisions of record (2026-07-26): direct-poll
# dispatch (fleet_waves is an execution surface → command-queue-grade protections);
# merge verb DEFERRED. Two ordered stages:
#
#   contract    A  feat/mcv2-wave-states    opus    (supabase PROPOSE + dispatch fn + SCHEMA_V2)  1 session
#   build       B  feat/mcv2-agent-runwave  opus    (agent/ launch loop — SECURITY-CRITICAL)      2 sessions
#               C  feat/mcv2-compose        sonnet  (cockpit/ Compose + confirm gate)
#
# Order: contract → consolidate + planner applies migration & deploys `dispatch`
#        → build (B ∥ C) → reviews → consolidate. B's live drill needs the planner
#        to confirm the self-test wave that C creates as a draft (or the planner
#        seeds one if C lags B).
#
# Registers wave mcv2-wave3 on the bus at dispatch via ops/waves/lib-register.sh.
#
# Run from the fleet-mission-control repo root on the Mac:
#   bash ops/waves/setup-mcv2-wave3.sh contract
#   bash ops/waves/setup-mcv2-wave3.sh build

set -euo pipefail

STAGE="${1:-}"
case "$STAGE" in contract|build) ;; *)
  echo "usage: bash ops/waves/setup-mcv2-wave3.sh {contract|build}"; exit 2 ;;
esac

FLEET="$(pwd)"
FLEET_WT="$(cd .. && pwd)/fleet-wt"
CONV="ops/prompts/PROMPT_fleet_conventions.md"

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo "ERROR: run from the fleet repo root."; exit 1; }
[ -f "$CONV" ] || { echo "ERROR: $CONV missing."; exit 1; }
[ -f "docs/SCHEMA_V2.md" ] || { echo "ERROR: docs/SCHEMA_V2.md missing — is main up to date?"; exit 1; }
[ -f "ops/waves/lib-register.sh" ] || { echo "ERROR: ops/waves/lib-register.sh missing — wave 2 not consolidated?"; exit 1; }
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

# ── Register the wave on the bus (once, at the first stage; idempotent re-register
#    on the second stage refreshes planning fields without resetting lifecycle). ──
# shellcheck source=ops/waves/lib-register.sh
. ops/waves/lib-register.sh
fleet_register_init "fleet-mission-control" "mcv2-wave3" \
  "MCv2 wave 3 (M4 phone dispatch): A wave-states contract (opus), B agent run-wave loop (opus, SECURITY-CRITICAL), C cockpit Compose (sonnet). Direct-poll dispatch; merge deferred."
fleet_register_add "mcv2-wave-states"   "feat/mcv2-wave-states"   "mac-cockpit" "opus" \
  "ops/prompts/PROMPT_mcv2_wave_states.md"   "../fleet-wt/mcv2-wave-states" \
  "vishal-h-pathak/fleet-mission-control"
fleet_register_add "mcv2-agent-runwave" "feat/mcv2-agent-runwave" "mac-cockpit" "opus" \
  "ops/prompts/PROMPT_mcv2_agent_runwave.md" "../fleet-wt/mcv2-agent-runwave" \
  "vishal-h-pathak/fleet-mission-control"
fleet_register_add "mcv2-compose"       "feat/mcv2-compose"       "mac-cockpit" "sonnet" \
  "ops/prompts/PROMPT_mcv2_compose.md"       "../fleet-wt/mcv2-compose" \
  "vishal-h-pathak/fleet-mission-control"
fleet_register_dispatch || echo "WARN: wave registration failed — dispatching anyway (planner reconciles)."

stage_contract () {
  require_prompt PROMPT_mcv2_wave_states.md
  add_worktree "$FLEET_WT/mcv2-wave-states" "feat/mcv2-wave-states"
  seed_fleet_wt "$FLEET_WT/mcv2-wave-states"
  open_session "$FLEET_WT/mcv2-wave-states" opus \
    "Read ./ops/prompts/PROMPT_fleet_conventions.md then ./ops/prompts/PROMPT_mcv2_wave_states.md and implement it on this branch (feat/mcv2-wave-states). Wave-dispatch lifecycle (draft->confirmed->launching->dispatched), per-session claim columns, and a new token-authed dispatch Edge Function (poll/claim/ack, per-machine scoping, directives never transported) — migrations PROPOSE only, function code on-branch only, dispatch-logic.mjs + tests, SCHEMA_V2.md contract section with the transition table and security invariants. fleet_waves is an execution surface: command-queue-grade rigor. Validate, then STOP and report — the planner applies and deploys. Do not begin until I confirm."
  cat <<DONE

Wave 3 / contract staged (A: wave-states, opus). Directive pasted, not submitted —
review + Return. When it reports: planner review -> consolidate -> planner applies the
migration + deploys the dispatch function -> then run 'build'.
DONE
}

stage_build () {
  require_prompt PROMPT_mcv2_agent_runwave.md
  require_prompt PROMPT_mcv2_compose.md
  grep -q 'dispatch' docs/SCHEMA_V2.md || echo "WARNING: SCHEMA_V2.md has no dispatch section on this checkout — has 'contract' been consolidated? Both sessions will STOP without it."

  add_worktree "$FLEET_WT/mcv2-agent-runwave" "feat/mcv2-agent-runwave"
  seed_fleet_wt "$FLEET_WT/mcv2-agent-runwave"
  open_session "$FLEET_WT/mcv2-agent-runwave" opus \
    "Read ./ops/prompts/PROMPT_fleet_conventions.md then ./ops/prompts/PROMPT_mcv2_agent_runwave.md and implement it on this branch (feat/mcv2-agent-runwave). SECURITY-CRITICAL: agent wave-launch loop — poll/claim/validate/launch cg-runi tmux sessions/ack. The bus is untrusted input: hard-coded repo set, charset validation, committed-prompts-only verified against origin/main at execution, agent-computed worktree paths, agent-composed directive template (bus free-text never executes), shell:false, parity check extended, reject-path unit tests incl. traversal and flag injection. Live fire drill per the prompt (planner confirms the self-test wave). When in doubt, STOP and ask. Validate, then STOP and report. Do not begin until I confirm."

  add_worktree "$FLEET_WT/mcv2-compose" "feat/mcv2-compose"
  seed_fleet_wt "$FLEET_WT/mcv2-compose"
  open_session "$FLEET_WT/mcv2-compose" sonnet \
    "Read ./ops/prompts/PROMPT_fleet_conventions.md then ./ops/prompts/PROMPT_mcv2_compose.md and implement it on this branch (feat/mcv2-compose). Build /compose in cockpit/ only: committed-prompts-only picker via a server-side read-only GitHub token, per-chunk machine/model/branch, agent-template preview, save-draft, and the deliberate Confirm screen (type-wave-name-to-arm; the ONLY writer of confirmed; defense-in-depth auth assert). Live validation creates the mcv2-w3-selftest wave as a DRAFT and stops there — never confirm it yourself. Validate, then STOP and report. Do not begin until I confirm."

  cat <<DONE

Wave 3 / build staged (B: agent-runwave opus, C: compose sonnet). Directives pasted,
not submitted — review + Return in each. B's live drill pauses until the planner
confirms the self-test wave (from C's draft, or planner-seeded). When both report:
reviews -> consolidate -> the first end-to-end phone dispatch.
DONE
}

echo "Staging Mission Control v2 — wave 3, stage: $STAGE"
case "$STAGE" in
  contract) stage_contract ;;
  build)    stage_build ;;
esac
