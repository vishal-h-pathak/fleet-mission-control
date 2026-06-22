#!/usr/bin/env bash
#
# install-fleet-hook.sh — install the Fleet completion hook ONCE per machine.
#
# What it does (idempotent, fail-soft on the optional bits):
#   1. Resolves the absolute path to fleet-notify.sh (next to this script) + chmod +x.
#   2. Creates the machine-level config ~/.config/fleet/hook.env (chmod 600) from
#      the template — filling NTFY_TOPIC / FLEET_TOKEN from env if you pass them,
#      otherwise leaving placeholders for you to edit. Never overwrites an existing
#      one without --force.
#   3. PRINTS the ~/.claude/settings.json snippet (with the resolved path) for you
#      to paste — settings are NOT auto-edited unless you pass --apply.
#   4. With --apply: jq-merges the two hooks into ~/.claude/settings.json after
#      backing it up. Refuses if jq is missing.
#
# Usage:
#   bash deploy/hooks/install-fleet-hook.sh
#   NTFY_TOPIC=fleet-xxxx FLEET_TOKEN=yyyy bash deploy/hooks/install-fleet-hook.sh
#   bash deploy/hooks/install-fleet-hook.sh --apply        # also merge settings.json
#   bash deploy/hooks/install-fleet-hook.sh --force        # rewrite hook.env
#
# Run once per machine (Mac + sentry). Every project inherits the hook thereafter.

set -u

APPLY=0
FORCE=0
for a in "$@"; do
  case "$a" in
    --apply) APPLY=1 ;;
    --force) FORCE=1 ;;
    -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "Unknown arg: $a" >&2; exit 2 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOOK_SH="$SCRIPT_DIR/fleet-notify.sh"
TEMPLATE="$SCRIPT_DIR/hook.env.example"
CONFIG_DIR="$HOME/.config/fleet"
CONFIG="$CONFIG_DIR/hook.env"
SETTINGS="$HOME/.claude/settings.json"

[ -f "$HOOK_SH" ] || { echo "ERROR: $HOOK_SH not found"; exit 1; }
chmod +x "$HOOK_SH" 2>/dev/null
echo "✓ hook script: $HOOK_SH"

# ── 1) machine-level config ───────────────────────────────────────────────────
mkdir -p "$CONFIG_DIR"
if [ -f "$CONFIG" ] && [ "$FORCE" -ne 1 ]; then
  echo "✓ config exists: $CONFIG (left as-is; --force to rewrite)"
else
  if [ -f "$TEMPLATE" ]; then cp "$TEMPLATE" "$CONFIG"; else : >"$CONFIG"; fi
  # Fill from env if provided (so the secret never has to live in the repo).
  if [ -n "${NTFY_TOPIC:-}" ]; then
    sed -i.bak "s|^NTFY_TOPIC=.*|NTFY_TOPIC=${NTFY_TOPIC}|" "$CONFIG" && rm -f "$CONFIG.bak"
  fi
  if [ -n "${FLEET_TOKEN:-}" ]; then
    sed -i.bak "s|^FLEET_TOKEN=.*|FLEET_TOKEN=${FLEET_TOKEN}|" "$CONFIG" && rm -f "$CONFIG.bak"
  fi
  chmod 600 "$CONFIG"
  echo "✓ wrote config: $CONFIG (chmod 600)"
  if grep -q 'REPLACE_WITH' "$CONFIG" 2>/dev/null; then
    echo "  ⚠ edit $CONFIG and set the real NTFY_TOPIC + FLEET_TOKEN (or re-run with them in env)."
  fi
fi

# ── 2) the settings.json snippet (resolved path) ──────────────────────────────
read -r -d '' SNIPPET <<JSON
{
  "hooks": {
    "SessionEnd": [
      { "hooks": [ { "type": "command", "command": "$HOOK_SH" } ] }
    ],
    "Notification": [
      { "matcher": "permission_prompt|idle_prompt",
        "hooks": [ { "type": "command", "command": "$HOOK_SH" } ] }
    ]
  }
}
JSON

echo
echo "── Add this to $SETTINGS (user level → every project inherits it) ──"
echo "$SNIPPET"
echo "───────────────────────────────────────────────────────────────────"

# ── 3) optional auto-merge ────────────────────────────────────────────────────
if [ "$APPLY" -eq 1 ]; then
  command -v jq >/dev/null 2>&1 || { echo "ERROR: --apply needs jq"; exit 1; }
  mkdir -p "$(dirname "$SETTINGS")"
  [ -f "$SETTINGS" ] || echo '{}' >"$SETTINGS"
  BACKUP="$SETTINGS.bak.$(date -u +%Y%m%dT%H%M%SZ)"
  cp "$SETTINGS" "$BACKUP"
  TMP="$(mktemp)"
  # Merge our two events into any existing .hooks (our entries are appended).
  if jq --arg cmd "$HOOK_SH" '
        .hooks.SessionEnd = ((.hooks.SessionEnd // []) + [ { hooks: [ { type:"command", command:$cmd } ] } ])
      | .hooks.Notification = ((.hooks.Notification // []) + [ { matcher:"permission_prompt|idle_prompt", hooks: [ { type:"command", command:$cmd } ] } ])
    ' "$SETTINGS" >"$TMP" 2>/dev/null && [ -s "$TMP" ]; then
    mv "$TMP" "$SETTINGS"
    echo "✓ merged hooks into $SETTINGS (backup: $BACKUP)"
    echo "  note: re-running --apply appends again — dedupe by hand if needed."
  else
    rm -f "$TMP"
    echo "ERROR: jq merge failed; $SETTINGS unchanged (backup at $BACKUP)"
    exit 1
  fi
fi

echo
echo "Done. Verify: end a Claude session in any project → desktop + ntfy push,"
echo "and tail the hook log:  tail -f ~/.fleet/hook.log"
