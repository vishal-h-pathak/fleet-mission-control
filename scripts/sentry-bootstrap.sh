#!/usr/bin/env bash
#
# sentry-bootstrap.sh — run ON sentry (WSL2) to bring the machine onto Fleet.
#
# What it does:
#   - clones (or pulls) the fleet-mission-control repo
#   - checks Node 18+
#   - writes a gitignored .env with this machine's token + identity
#   - sends a test heartbeat (--dry-run then --once)
#   - prints the systemd install steps (does NOT sudo for you)
#
# Usage (from anywhere on sentry, in WSL bash):
#   FLEET_TOKEN=<sentry-token> bash sentry-bootstrap.sh
# or, if you've already cloned the repo:
#   cd ~/dev/jarvis/fleet-mission-control && FLEET_TOKEN=<sentry-token> bash scripts/sentry-bootstrap.sh
#
# The sentry token came from: select public.fleet_register_machine('sentry','compute','100.86.154.46');
# Treat it as a secret. (Passing via env avoids baking it into the repo.)

set -euo pipefail

REPO_URL="https://github.com/vishal-h-pathak/fleet-mission-control.git"
REPO_DIR="${FLEET_REPO_DIR:-$HOME/dev/jarvis/fleet-mission-control}"
INGEST_URL="https://sbmsxerwgylpfkkkjtku.supabase.co/functions/v1/ingest"
MACHINE_NAME="sentry"
LOG_DIR="${FLEET_COCKPIT_LOG_DIR:-$HOME/cockpit-logs}"

[ -n "${FLEET_TOKEN:-}" ] || { echo "ERROR: set FLEET_TOKEN first:  FLEET_TOKEN=<sentry-token> bash $0"; exit 1; }

# 1) Node 18+
command -v node >/dev/null 2>&1 || { echo "ERROR: Node not found. Install Node 18+ in WSL (e.g. via nvm)."; exit 1; }
node_major="$(node -p 'process.versions.node.split(".")[0]')"
[ "$node_major" -ge 18 ] || { echo "ERROR: Node $((node_major)) too old; need 18+."; exit 1; }

# 2) Clone or update the repo
if [ -d "$REPO_DIR/.git" ]; then
  echo "Updating $REPO_DIR ..."
  git -C "$REPO_DIR" pull --ff-only
else
  echo "Cloning into $REPO_DIR ..."
  mkdir -p "$(dirname "$REPO_DIR")"
  git clone "$REPO_URL" "$REPO_DIR"
fi

# 3) Write .env (gitignored) at repo root
ENV_FILE="$REPO_DIR/.env"
cat > "$ENV_FILE" <<EOF
FLEET_TOKEN=$FLEET_TOKEN
FLEET_INGEST_URL=$INGEST_URL
FLEET_HEARTBEAT_INTERVAL_S=10
FLEET_COCKPIT_LOG_DIR=$LOG_DIR
FLEET_MACHINE_NAME=$MACHINE_NAME
EOF
chmod 600 "$ENV_FILE"
echo "Wrote $ENV_FILE (gitignored)."
mkdir -p "$LOG_DIR"

# 4) Test: dry-run then one live heartbeat
cd "$REPO_DIR"
echo "=== --dry-run (payload preview) ==="
node index.mjs --dry-run
echo "=== --once (live heartbeat to ingest) ==="
node index.mjs --once
echo
echo "If you saw {ok:true}, sentry is reporting. Check the dashboard: https://fleet-mission-control.vercel.app"
echo
cat <<NEXT
To keep it live as a background service (systemd in WSL):

  sudo cp $REPO_DIR/deploy/systemd/fleet-reporter.service /etc/systemd/system/
  # edit the unit if needed: WorkingDirectory=$REPO_DIR, EnvironmentFile=$ENV_FILE, ExecStart=\$(command -v node) $REPO_DIR/index.mjs
  sudo systemctl daemon-reload
  sudo systemctl enable --now fleet-reporter
  journalctl -u fleet-reporter -f

(If your WSL doesn't run systemd, either enable it in /etc/wsl.conf [boot] systemd=true and
'wsl --shutdown' from Windows, or just run 'node index.mjs' inside a tmux session.)
NEXT
