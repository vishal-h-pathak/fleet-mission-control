#!/usr/bin/env bash
#
# setup-mcv2-wave1.sh — stage Mission Control v2, wave 1 (run on the MAC).
#
# Plan: docs/V2_PLAN.md (§4). Two ordered stages:
#
#   batch       Parallel foundation — independent files, run concurrently.     2 sessions
#                 hook-pr  M0  feat/mcv2-hook-pr  sonnet  (deploy/hooks/ + docs)
#                 schema   M1  feat/mcv2-schema   opus    (supabase/ + ops/bin/) [PROPOSES migrations, stops]
#
#   inbox       After 'batch' is consolidated AND the planner has applied the  1 session
#               v2 migrations + deployed ingest v5 — this depends on both.
#                 inbox    M2  feat/mcv2-inbox    sonnet  (new cockpit/ only)
#
# Order to run:  batch  →  (confirm, consolidate, planner applies migrations + deploys ingest)
#                →  inbox  →  (confirm, consolidate)  =  wave 1 done.
# Each opens a Terminal window per session, claude running with the chunk's model, directive
# PASTED-UNSENT (review, Return).
#
# Run from the fleet-mission-control repo root on the Mac:
#   bash ops/waves/setup-mcv2-wave1.sh batch
#   bash ops/waves/setup-mcv2-wave1.sh inbox

set -euo pipefail

STAGE="${1:-}"
case "$STAGE" in batch|inbox) ;; *)
  echo "usage: bash ops/waves/setup-mcv2-wave1.sh {batch|inbox}"; exit 2 ;;
esac

FLEET="$(pwd)"
FLEET_WT="$(cd .. && pwd)/fleet-wt"
CONV="ops/prompts/PROMPT_fleet_conventions.md"

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo "ERROR: run from the fleet repo root."; exit 1; }
[ -f "$CONV" ] || { echo "ERROR: $CONV missing."; exit 1; }
[ -f "docs/V2_PLAN.md" ] || { echo "ERROR: docs/V2_PLAN.md missing."; exit 1; }
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

stage_batch () {
  require_prompt PROMPT_mcv2_hook_pr.md
  require_prompt PROMPT_mcv2_schema.md

  add_worktree "$FLEET_WT/mcv2-hook-pr" "feat/mcv2-hook-pr"
  seed_fleet_wt "$FLEET_WT/mcv2-hook-pr"
  open_session "$FLEET_WT/mcv2-hook-pr" sonnet \
    "Read ./ops/prompts/PROMPT_fleet_conventions.md then ./ops/prompts/PROMPT_mcv2_hook_pr.md and implement it on this branch (feat/mcv2-hook-pr). Extend deploy/hooks/fleet-notify.sh: on SessionEnd, idempotently ensure a draft PR for the session's pushed feature branch via gh (body = final message + /rc footer), carry pr_url on the bus POST, prefer the PR URL in the ntfy Click header. Fail-soft everywhere, never push code from the hook, no new secrets, hook scope only — the schema sibling owns ingest. Validate live on the Mac, then STOP and report. Do not begin until I confirm."

  add_worktree "$FLEET_WT/mcv2-schema" "feat/mcv2-schema"
  seed_fleet_wt "$FLEET_WT/mcv2-schema"
  open_session "$FLEET_WT/mcv2-schema" opus \
    "Read ./ops/prompts/PROMPT_fleet_conventions.md then ./ops/prompts/PROMPT_mcv2_schema.md and implement it on this branch (feat/mcv2-schema). Design the work-centric v2 spine: fleet_projects/waves/sessions/decisions migrations (PROPOSE only, all private deny-all RLS, do NOT apply or deploy anything), ingest v5 (pr_url routing, session enrichment with ungrouped fallback, v1 idempotency preserved), ops/bin/fleet-register-wave.mjs (zero-dep, --dry-run), and docs/SCHEMA_V2.md as the binding contract. Walk the race matrix in your report. Validate, then STOP and report — I apply migrations and deploy. Do not begin until I confirm."

  cat <<DONE

MCv2 wave 1 / batch staged (2 parallel: hook-pr M0 sonnet, schema M1 opus). Directives pasted,
not submitted — review + Return in each. NOTE: 'schema' PROPOSES migrations and stops; the
planner applies them + deploys ingest v5 at consolidation. When both report, consolidate,
apply, deploy — only then run 'inbox'.
DONE
}

stage_inbox () {
  require_prompt PROMPT_mcv2_inbox.md
  [ -f "docs/SCHEMA_V2.md" ] || echo "WARNING: docs/SCHEMA_V2.md not on this checkout — has 'batch' been consolidated? The inbox session will STOP without it."

  add_worktree "$FLEET_WT/mcv2-inbox" "feat/mcv2-inbox"
  seed_fleet_wt "$FLEET_WT/mcv2-inbox"
  open_session "$FLEET_WT/mcv2-inbox" sonnet \
    "Read ./ops/prompts/PROMPT_fleet_conventions.md then ./ops/prompts/PROMPT_mcv2_inbox.md and implement it on this branch (feat/mcv2-inbox). Scaffold the new authed-only cockpit/ app (Next.js 16 / React 19 / Tailwind 4 / supabase-js, magic-link auth gated to allowlisted emails, all reads via service-role server routes) and build Inbox v1 per docs/SCHEMA_V2.md: needs-you / awaiting-review (summary + Open PR + Open /rc + approve/redispatch/reject writing fleet_decisions) / recently-decided, mobile-first, polling. cockpit/ dir only; no Vercel setup; deep-link diffs and /rc, never rebuild them. Validate against the live bus, then STOP and report. Do not begin until I confirm."

  cat <<DONE

MCv2 wave 1 / inbox staged (M2, sonnet, depends on applied v2 schema + deployed ingest v5).
Directive pasted, not submitted — review + Return. When it reports, consolidate: that
completes wave 1 (phone-native review end-to-end: auto-draft-PR -> ntfy deep-link -> Inbox).
DONE
}

echo "Staging Mission Control v2 — wave 1, stage: $STAGE"
case "$STAGE" in
  batch) stage_batch ;;
  inbox) stage_inbox ;;
esac
