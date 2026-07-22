#!/usr/bin/env bash
#
# fleet-notify.sh — Fleet Mission Control completion hook (Phase D, F2-a).
#
# A SINGLE, per-machine Claude Code hook that fires on the lifecycle events
# below and (a) pushes a human notification (desktop banner + ntfy-over-Tailscale)
# and (b) writes a completion record into the fleet bus. Installed ONCE per machine
# at the user level (~/.claude/settings.json) so EVERY project, every session —
# headless `cg run`, interactive `cg runi`, local Mac — self-reports with zero
# per-project setup. See deploy/hooks/install-fleet-hook.sh + docs/LOOP_CLOSER.md.
#
# Events (dispatched on .hook_event_name from the stdin JSON):
#   SessionEnd   = the completion signal (fires once per session, headless +
#                  interactive). -> desktop + ntfy push AND a bus POST marking the
#                  session finished, carrying its final assistant message + /rc URL.
#                  Also (MCv2 M0): ensures an idempotent draft PR exists for the
#                  session's pushed branch (via `gh`), carries pr_url on the bus
#                  POST, and prefers the PR URL over /rc in the push Click header.
#   Notification = a "needs you" ping (Claude waiting for input/permission).
#                  -> push ONLY. No bus completion row.
#
# Hook JSON shapes (verified against code.claude.com/docs/en/hooks + a live
# transcript, 2026-06-22 — neither event carries the final message inline):
#   SessionEnd:   { session_id, transcript_path, cwd, hook_event_name, reason }
#   Notification: { session_id, transcript_path, cwd, hook_event_name,
#                   notification_type, message }
# The final assistant text is read from transcript_path (JSONL): the LAST line
# with type=="assistant" whose .message.content[] contains a {type:"text"} block.
#
# Dependencies: POSIX-ish bash + curl + jq. No npm, no pip.
#
# FAIL-SOFT IS THE PRIME DIRECTIVE: a hook must NEVER block, hang, or error the
# session. Every external call is time-boxed and its failure swallowed + logged.
# This script always exits 0.

# Deliberately NOT `set -e`/`set -u` — a hook must never abort the session on an
# unexpected non-zero or unset var. We default every var and guard every call.

# ── Config (machine-level, gitignored env file; env vars override) ────────────
HOOK_ENV="${FLEET_HOOK_ENV:-$HOME/.config/fleet/hook.env}"
# shellcheck disable=SC1090
[ -f "$HOOK_ENV" ] && . "$HOOK_ENV" 2>/dev/null

NTFY_BASE_URL="${NTFY_BASE_URL:-}"
NTFY_TOPIC="${NTFY_TOPIC:-}"
FLEET_TOKEN="${FLEET_TOKEN:-}"
INGEST_URL="${FLEET_INGEST_URL:-https://sbmsxerwgylpfkkkjtku.supabase.co/functions/v1/ingest}"
LOG_DIR="${FLEET_COCKPIT_LOG_DIR:-$HOME/cockpit-logs}"
CURL_MAX_TIME="${FLEET_HOOK_CURL_MAX_TIME:-8}"

# How much of the final message to send: full to the bus (capped), short to push.
MSG_BUS_MAXLEN="${FLEET_RESULT_MAXLEN:-16000}"
MSG_PUSH_MAXLEN=400

# MCv2 M0 — draft-PR completion gate. Opt out per machine with FLEET_PR_DISABLE=1.
FLEET_PR_DISABLE="${FLEET_PR_DISABLE:-0}"
FLEET_PR_BODY_MAXLEN="${FLEET_PR_BODY_MAXLEN:-16000}"

HOOK_LOG="${FLEET_HOOK_LOG:-$HOME/.fleet/hook.log}"

log() {
  # Best-effort local log; never fails the script.
  mkdir -p "$(dirname "$HOOK_LOG")" 2>/dev/null
  printf '[fleet-notify] %s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >>"$HOOK_LOG" 2>/dev/null
}

# Expand a leading ~/ in a config path (env files often store it literally).
# shellcheck disable=SC2088  # the pattern matches a LITERAL "~/" prefix, by design.
case "$LOG_DIR" in "~/"*) LOG_DIR="$HOME/${LOG_DIR#~/}";; esac

# ── Read + parse the hook JSON on stdin ───────────────────────────────────────
INPUT="$(cat 2>/dev/null)"
if ! command -v jq >/dev/null 2>&1; then
  log "jq not found on PATH — cannot parse hook input; exiting soft"
  exit 0
fi

jget() { printf '%s' "$INPUT" | jq -r "$1 // empty" 2>/dev/null; }

EVENT="$(jget '.hook_event_name')"
TRANSCRIPT="$(jget '.transcript_path')"
CWD="$(jget '.cwd')"
SESSION_ID="$(jget '.session_id')"
REASON="$(jget '.reason')"
NOTIF_TYPE="$(jget '.notification_type')"
NOTIF_MSG="$(jget '.message')"

[ -z "$CWD" ] && CWD="$PWD"
# (The fleet bus identifies the machine by its bearer token, not by name, so the
#  hook doesn't need to compute/send a machine name.)

# ── Derive session context: tmux name, repo/project, git branch, /rc URL ──────
TMUX_NAME=""
if [ -n "${TMUX:-}" ] && command -v tmux >/dev/null 2>&1; then
  TMUX_NAME="$(tmux display-message -p '#S' 2>/dev/null)"
fi

PROJECT=""
BRANCH=""
if command -v git >/dev/null 2>&1; then
  TOPLEVEL="$(git -C "$CWD" rev-parse --show-toplevel 2>/dev/null)"
  [ -n "$TOPLEVEL" ] && PROJECT="$(basename "$TOPLEVEL")"
  BRANCH="$(git -C "$CWD" rev-parse --abbrev-ref HEAD 2>/dev/null)"
fi
[ -z "$PROJECT" ] && PROJECT="$(basename "$CWD" 2>/dev/null)"

# Job name: prefer the tmux session name (so a finished record matches the
# reporter's running row for `cg run`/`runi`); else a stable per-session fallback.
if [ -n "$TMUX_NAME" ]; then
  JOB_NAME="$TMUX_NAME"
else
  JOB_NAME="claude-${SESSION_ID:0:8}"
fi

# /rc URL: the Phase-B sidecar at $LOG_DIR/<tmux-name>.rc (only meaningful when
# the session ran under a known tmux name).
RC_URL=""
if [ -n "$TMUX_NAME" ] && [ -f "$LOG_DIR/$TMUX_NAME.rc" ]; then
  RC_URL="$(head -n1 "$LOG_DIR/$TMUX_NAME.rc" 2>/dev/null | tr -d '\r\n')"
fi

# Draft-PR URL (MCv2 M0), set by ensure_draft_pr() on SessionEnd only. Empty on
# Notification and whenever PR creation is skipped/fails — always fail-soft.
PR_URL=""

# ── Extract the final assistant message from the transcript (SessionEnd) ──────
# Last assistant line that actually has text; multi-block messages are joined.
# Emitted base64 per-message so newlines survive the `tail -1`, then decoded.
last_assistant_message() {
  [ -n "$TRANSCRIPT" ] && [ -f "$TRANSCRIPT" ] || return 0
  local b64
  b64="$(jq -rc '
      select(.type=="assistant")
      | ([ .message.content[]? | select(.type=="text") | .text ] | join("\n")) as $t
      | select($t != "")
      | $t | @base64
    ' "$TRANSCRIPT" 2>/dev/null | tail -1)"
  [ -n "$b64" ] && printf '%s' "$b64" | jq -Rr '@base64d' 2>/dev/null
}

truncate_str() { # <maxlen>  (reads stdin)
  awk -v max="$1" '{ buf = buf $0 "\n" } END {
    sub(/\n$/, "", buf)
    if (length(buf) > max) printf "%s…", substr(buf, 1, max); else printf "%s", buf
  }'
}

# ── Draft-PR completion gate (MCv2 M0) ─────────────────────────────────────────
# gh has no --max-time; wrap with timeout/gtimeout where available, else run
# unguarded (still fail-soft: every caller checks output, never aborts the hook).
gh_run() { # <dir> <gh-args...>
  local dir="$1"; shift
  if command -v timeout >/dev/null 2>&1; then
    (cd "$dir" 2>/dev/null && timeout "${CURL_MAX_TIME}s" gh "$@")
  elif command -v gtimeout >/dev/null 2>&1; then
    (cd "$dir" 2>/dev/null && gtimeout "${CURL_MAX_TIME}s" gh "$@")
  else
    (cd "$dir" 2>/dev/null && gh "$@")
  fi
}

# Ensures an idempotent draft PR exists for the session's branch. Sets $PR_URL
# on success, leaves it "" (and logs why) on any skip/failure — never blocks
# SessionEnd. Reuse an existing PR (draft or open) rather than duplicating one.
ensure_draft_pr() { # <final_message>
  PR_URL=""
  [ "$FLEET_PR_DISABLE" = "1" ] && { log "PR: FLEET_PR_DISABLE=1 — skipping"; return 0; }
  command -v gh  >/dev/null 2>&1 || { log "PR: gh not found — skipping"; return 0; }
  command -v git >/dev/null 2>&1 || { log "PR: git not found — skipping"; return 0; }

  local msg="$1" toplevel repo_json default_branch name_with_owner existing body_file created

  toplevel="$(git -C "$CWD" rev-parse --show-toplevel 2>/dev/null)"
  [ -n "$toplevel" ] || { log "PR: not a git repo — skipping"; return 0; }

  git -C "$toplevel" symbolic-ref -q HEAD >/dev/null 2>&1 \
    || { log "PR: detached HEAD — skipping"; return 0; }
  [ -n "$BRANCH" ] || { log "PR: no branch resolved — skipping"; return 0; }

  git -C "$toplevel" rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1 \
    || { log "PR: branch '$BRANCH' has no upstream (not pushed) — skipping"; return 0; }

  repo_json="$(gh_run "$toplevel" repo view --json defaultBranchRef,nameWithOwner 2>/dev/null)"
  [ -n "$repo_json" ] \
    || { log "PR: gh repo view failed (unauthed/no GitHub remote/gh broken) — skipping"; return 0; }

  default_branch="$(printf '%s' "$repo_json" | jq -r '.defaultBranchRef.name // empty' 2>/dev/null)"
  name_with_owner="$(printf '%s' "$repo_json" | jq -r '.nameWithOwner // empty' 2>/dev/null)"
  [ -n "$default_branch" ] && [ -n "$name_with_owner" ] \
    || { log "PR: could not resolve default branch / repo slug — skipping"; return 0; }

  [ "$BRANCH" = "$default_branch" ] \
    && { log "PR: branch is the default branch ($default_branch) — skipping"; return 0; }

  existing="$(gh_run "$toplevel" pr list --repo "$name_with_owner" --head "$BRANCH" \
                --json url -q '.[0].url // empty' 2>/dev/null)"
  if [ -n "$existing" ]; then
    PR_URL="$existing"
    log "PR: reusing existing PR for branch $BRANCH — $PR_URL"
    return 0
  fi

  body_file="$(mktemp 2>/dev/null)" || { log "PR: mktemp failed — skipping"; return 0; }
  {
    printf '%s' "$msg" | truncate_str "$FLEET_PR_BODY_MAXLEN"
    printf '\n\n---\n'
    [ -n "$RC_URL" ] && printf '**/rc:** %s\n' "$RC_URL"
    printf '**Machine job:** %s\n' "$JOB_NAME"
    printf '\n_via fleet-mission-control completion hook_\n'
  } >"$body_file" 2>/dev/null

  created="$(gh_run "$toplevel" pr create --draft --repo "$name_with_owner" \
              --base "$default_branch" --head "$BRANCH" \
              --title "$BRANCH — $PROJECT" --body-file "$body_file" 2>/dev/null)"
  rm -f "$body_file" 2>/dev/null

  # `gh pr create` prints the PR URL as the last non-empty stdout line.
  PR_URL="$(printf '%s' "$created" | tr -d '\r' | awk 'NF{line=$0} END{print line}')"
  if [ -n "$PR_URL" ]; then
    log "PR: created draft PR for branch $BRANCH — $PR_URL"
  else
    log "PR: gh pr create failed / produced no URL — skipping"
  fi
}

# ── Notifiers (all fail-soft, time-boxed) ─────────────────────────────────────
desktop_notify() { # <title> <body>
  local title="$1" body="$2"
  case "$(uname -s 2>/dev/null)" in
    Darwin)
      if command -v osascript >/dev/null 2>&1; then
        # Sanitize for AppleScript string literals.
        local t b
        t="$(printf '%s' "$title" | tr '\n' ' ' | sed 's/[\\"]/ /g')"
        b="$(printf '%s' "$body"  | tr '\n' ' ' | sed 's/[\\"]/ /g')"
        osascript -e "display notification \"$b\" with title \"$t\"" >/dev/null 2>&1 \
          || log "osascript notify failed"
      fi
      ;;
    *)
      if command -v notify-send >/dev/null 2>&1; then
        notify-send "$title" "$body" >/dev/null 2>&1 || log "notify-send failed"
      fi
      ;;
  esac
}

ntfy_push() { # <title> <tags> <body>
  local title="$1" tags="$2" body="$3"
  if [ -z "$NTFY_BASE_URL" ] || [ -z "$NTFY_TOPIC" ]; then
    log "ntfy not configured (NTFY_BASE_URL/NTFY_TOPIC unset) — skipping push"
    return 0
  fi
  # Header values must be single-line.
  local hdr_title hdr_tags
  hdr_title="$(printf '%s' "$title" | tr '\n' ' ')"
  hdr_tags="$(printf '%s' "$tags" | tr '\n' ' ')"
  local args=(-fsS --max-time "$CURL_MAX_TIME"
              -H "Title: $hdr_title" -H "Tags: $hdr_tags")
  # Prefer the draft PR over /rc for the tap-through target when both exist.
  local click_url="${PR_URL:-$RC_URL}"
  [ -n "$click_url" ] && args+=(-H "Click: $click_url")
  curl "${args[@]}" -d "$body" "$NTFY_BASE_URL/$NTFY_TOPIC" >/dev/null 2>&1 \
    && log "ntfy push ok ($hdr_title)" \
    || log "ntfy push failed ($hdr_title)"
}

bus_post_finished() { # <last_message> <pr_url>
  local msg="$1" pr="$2"
  if [ -z "$FLEET_TOKEN" ]; then
    log "FLEET_TOKEN unset — skipping bus POST"
    return 0
  fi
  local now body
  now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  # Contract (F2-a, + MCv2 M0 pr_url): a heartbeat-shaped body whose jobs[] entry
  # marks the session finished. last_message + rc_url + pr_url are SENSITIVE ->
  # the sibling `schema` session routes them to private storage (fleet_job_links /
  # fleet_sessions). We send them per contract even if ingest currently ignores
  # pr_url; we do NOT mirror into log_tail (per decision 2026-06-22).
  body="$(jq -nc \
    --arg name "$JOB_NAME" --arg project "$PROJECT" --arg ended "$now" \
    --arg msg "$msg" --arg rc "$RC_URL" --arg pr "$pr" --arg branch "$BRANCH" '
    { jobs: [
        ( { name: $name, kind: "claude-session", status: "finished",
            ended_at: $ended, last_message: $msg }
          + (if $project != "" then { project: $project } else {} end)
          + (if $rc != ""      then { rc_url: $rc }       else {} end)
          + (if $pr != ""      then { pr_url: $pr }       else {} end)
          + (if $branch != "" then { branch: $branch } else {} end) )
    ] }' 2>/dev/null)"
  [ -n "$body" ] || { log "bus POST skipped — jq failed to build body"; return 0; }
  # Redacted log: field presence + lengths only — last_message/rc_url/pr_url are
  # SENSITIVE and must never be persisted verbatim to the (world-readable) hook.log.
  log "bus POST body: name=$JOB_NAME project=${PROJECT:+set} branch=${BRANCH:+set} last_message_len=${#msg} rc_url=${RC_URL:+set} pr_url=${pr:+set}"

  local code
  code="$(curl -sS --max-time "$CURL_MAX_TIME" -o /dev/null -w '%{http_code}' \
            -X POST "$INGEST_URL" \
            -H "Authorization: Bearer $FLEET_TOKEN" \
            -H "Content-Type: application/json" \
            -d "$body" 2>/dev/null)"
  if [ "$code" = "200" ]; then
    log "bus POST ok — name=$JOB_NAME project=$PROJECT rc=${RC_URL:+yes} pr=${pr:+yes}"
  else
    log "bus POST failed http=$code name=$JOB_NAME"
  fi
}

# ── Dispatch ──────────────────────────────────────────────────────────────────
case "$EVENT" in
  SessionEnd)
    MSG="$(last_assistant_message)"
    [ -z "$MSG" ] && MSG="(session ended — no final text message)"
    ensure_draft_pr "$MSG"
    PUSH_BODY="$(printf '%s' "$MSG" | truncate_str "$MSG_PUSH_MAXLEN")"
    [ -n "$BRANCH" ] && PUSH_BODY="$PUSH_BODY
— $PROJECT @ $BRANCH"
    [ -n "$PR_URL" ] && PUSH_BODY="$PUSH_BODY
📋 PR ready for review"
    desktop_notify "✅ $PROJECT — session finished" "$PUSH_BODY"
    ntfy_push "✅ $PROJECT — session finished" "white_check_mark" "$PUSH_BODY"
    BUS_MSG="$(printf '%s' "$MSG" | truncate_str "$MSG_BUS_MAXLEN")"
    bus_post_finished "$BUS_MSG" "$PR_URL"
    log "SessionEnd handled (reason=${REASON:-?}) name=$JOB_NAME pr=${PR_URL:+yes}"
    ;;

  Notification)
    NMSG="${NOTIF_MSG:-Claude needs your input}"
    PUSH_BODY="$(printf '%s' "$NMSG" | truncate_str "$MSG_PUSH_MAXLEN")"
    [ -n "$PROJECT" ] && PUSH_BODY="$PUSH_BODY
— $PROJECT${BRANCH:+ @ $BRANCH}"
    desktop_notify "🔔 $PROJECT — needs you" "$PUSH_BODY"
    ntfy_push "🔔 $PROJECT — needs you" "bell" "$PUSH_BODY"
    # No bus completion row for a "needs you" ping.
    log "Notification handled (type=${NOTIF_TYPE:-?}) name=$JOB_NAME"
    ;;

  "")
    log "no hook_event_name in stdin — nothing to do"
    ;;
  *)
    log "unhandled event=$EVENT — nothing to do"
    ;;
esac

exit 0
