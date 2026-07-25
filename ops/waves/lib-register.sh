#!/usr/bin/env bash
#
# lib-register.sh — sourceable helper: register a dispatched wave of `planned`
# sessions on the fleet bus via ops/bin/fleet-register-wave.mjs, so each Code run
# exists as a work item on the cockpit *before* it runs; ingest v5 then enriches it
# (planned -> running -> done) as telemetry lands. See docs/SCHEMA_V2.md.
#
# Extracted from the inline `register_wave()` pattern in ops/waves/setup-mcv2-wave2.sh
# (wave 2's launcher) so later launchers don't reinvent it. That file is left as-is;
# this is the reusable shape going forward.
#
# FAIL-SOFT IS THE PRIME DIRECTIVE, same as the completion hook: a registration
# failure (no token, no jq/node, network error, non-200) WARNS to stderr and
# returns 0. It must never abort a wave dispatch — the planner reconciles at
# consolidation if registration didn't happen.
#
# Usage (source from a setup-*.sh launcher; call from the repo root so relative
# paths like prompt_ref resolve the way the cockpit expects, though the helper
# itself locates its own node script and .env via its own path, not cwd):
#
#   source ops/waves/lib-register.sh
#
#   fleet_register_init "fleet-mission-control" "mywave" "optional notes"
#   fleet_register_add "chunk-a" "feat/chunk-a" "mac-cockpit" "sonnet" \
#                       "ops/prompts/PROMPT_chunk_a.md" "../fleet-wt/chunk-a" \
#                       "vishal-h-pathak/fleet-mission-control"
#   fleet_register_add "chunk-b" "feat/chunk-b" "mac-cockpit" "opus" \
#                       "ops/prompts/PROMPT_chunk_b.md" "../fleet-wt/chunk-b"
#   fleet_register_dispatch              # POSTs; prints the returned wave/session ids
#   # or: fleet_register_dispatch --dry-run   (prints the payload only, no token needed)
#
# FLEET_TOKEN is read from the repo root's gitignored `.env` or `.fleet-secrets.env`
# (first `FLEET_TOKEN=` line wins) — same lookup fleet-notify.sh's hook.env uses.
# Requires jq + node on PATH (jq builds the manifest safely; node runs the bus call).

_FLEET_REG_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
_FLEET_REG_BIN="$_FLEET_REG_LIB_DIR/../bin/fleet-register-wave.mjs"
_FLEET_REG_REPO_ROOT="$(cd "$_FLEET_REG_LIB_DIR/../.." >/dev/null 2>&1 && pwd)"

_FLEET_REG_PROJECT=""
_FLEET_REG_WAVE_NAME=""
_FLEET_REG_WAVE_NOTES=""
_FLEET_REG_WAVE_STATUS="dispatched"
_FLEET_REG_SESSIONS=()

# fleet_register_init <project> <wave_name> [notes] [wave_status=dispatched]
fleet_register_init() {
  _FLEET_REG_PROJECT="$1"
  _FLEET_REG_WAVE_NAME="$2"
  _FLEET_REG_WAVE_NOTES="${3:-}"
  _FLEET_REG_WAVE_STATUS="${4:-dispatched}"
  _FLEET_REG_SESSIONS=()
}

# fleet_register_add <name> <branch> <machine> <model> <prompt_ref> [worktree] [repo]
# `name` is the tmux/job name (or the registered branch handle); charset
# [A-Za-z0-9._/-]{1,200}, enforced server-side by ingest — a bad name fails that
# one session's registration (still fail-soft: warns, doesn't add it, dispatch
# continues) rather than the whole wave.
fleet_register_add() {
  local name="$1" branch="$2" machine="$3" model="$4" prompt_ref="$5" worktree="${6:-}" repo="${7:-}"
  if ! command -v jq >/dev/null 2>&1; then
    echo "WARN: fleet_register_add($name) — jq not found, skipping this session's registration entry." >&2
    return 0
  fi
  local session
  session="$(jq -nc \
    --arg name "$name" --arg branch "$branch" --arg machine "$machine" \
    --arg model "$model" --arg prompt_ref "$prompt_ref" \
    --arg worktree "$worktree" --arg repo "$repo" \
    '{name: $name, branch: $branch, machine: $machine, model: $model, prompt_ref: $prompt_ref}
     + (if $worktree != "" then {worktree: $worktree} else {} end)
     + (if $repo != ""     then {repo: $repo}         else {} end)')"
  _FLEET_REG_SESSIONS+=("$session")
}

# Resolve FLEET_TOKEN from a repo root's gitignored env files. Prints the token
# and returns 0 on success; returns 1 (nothing printed) if not found.
_fleet_register_token() {
  local root="$1" f token
  for f in "$root/.env" "$root/.fleet-secrets.env"; do
    [ -f "$f" ] || continue
    token="$(grep -m1 '^FLEET_TOKEN=' "$f" 2>/dev/null | cut -d= -f2-)"
    [ -n "$token" ] && { printf '%s' "$token"; return 0; }
  done
  return 1
}

# fleet_register_dispatch [--dry-run] [repo_root]
# repo_root (for the .env/.fleet-secrets.env lookup) defaults to this file's own
# repo root (two levels up from ops/waves/), so it works regardless of the
# caller's cwd — override it only if registering against a different checkout.
fleet_register_dispatch() {
  local dry_run=0 root="$_FLEET_REG_REPO_ROOT"
  for a in "$@"; do
    case "$a" in
      --dry-run) dry_run=1 ;;
      *) root="$a" ;;
    esac
  done

  if [ "${#_FLEET_REG_SESSIONS[@]}" -eq 0 ]; then
    echo "WARN: fleet_register_dispatch — no sessions added (call fleet_register_add first), skipping." >&2
    return 0
  fi
  if [ -z "$_FLEET_REG_WAVE_NAME" ] || [ -z "$_FLEET_REG_PROJECT" ]; then
    echo "WARN: fleet_register_dispatch — call fleet_register_init first, skipping." >&2
    return 0
  fi
  command -v node >/dev/null 2>&1 || { echo "WARN: fleet_register_dispatch — node not found, skipping." >&2; return 0; }
  command -v jq   >/dev/null 2>&1 || { echo "WARN: fleet_register_dispatch — jq not found, skipping." >&2; return 0; }
  [ -f "$_FLEET_REG_BIN" ] || { echo "WARN: fleet_register_dispatch — $_FLEET_REG_BIN missing, skipping." >&2; return 0; }

  local sessions_json manifest
  sessions_json="$(printf '%s\n' "${_FLEET_REG_SESSIONS[@]}" | jq -s '.')"
  manifest="$(mktemp 2>/dev/null)" || { echo "WARN: fleet_register_dispatch — mktemp failed, skipping." >&2; return 0; }
  jq -n \
    --arg project "$_FLEET_REG_PROJECT" \
    --arg wave "$_FLEET_REG_WAVE_NAME" \
    --arg notes "$_FLEET_REG_WAVE_NOTES" \
    --arg status "$_FLEET_REG_WAVE_STATUS" \
    --argjson sessions "$sessions_json" \
    '{project: $project,
      wave: ({name: $wave, status: $status} + (if $notes != "" then {notes: $notes} else {} end)),
      sessions: $sessions}' \
    >"$manifest"

  if [ "$dry_run" -eq 1 ]; then
    echo "-- fleet_register_dispatch --dry-run (payload below; nothing sent, no token needed) --"
    node "$_FLEET_REG_BIN" --dry-run --manifest "$manifest"
    rm -f "$manifest"
    return 0
  fi

  local token
  if ! token="$(_fleet_register_token "$root")"; then
    echo "WARN: FLEET_TOKEN not found in $root/.env or $root/.fleet-secrets.env — skipping wave registration (dispatching anyway)." >&2
    rm -f "$manifest"
    return 0
  fi

  if FLEET_TOKEN="$token" node "$_FLEET_REG_BIN" --manifest "$manifest"; then
    echo "  wave registered on the bus."
  else
    echo "WARN: wave registration failed — dispatching anyway (planner reconciles)." >&2
  fi
  rm -f "$manifest"
}
