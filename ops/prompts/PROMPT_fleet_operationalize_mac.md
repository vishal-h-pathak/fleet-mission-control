# Operationalize the Mac (reporter + control agent as services)

> Hand this to a Claude Code session opened in `~/dev/jarvis/fleet-mission-control` ON THE MAC.
> Goal: the reporter and the control agent run continuously as launchd services (survive logout/
> reboot), so `mac-cockpit` stays online and can execute dispatched commands. Use judgment; inspect
> before changing; validate before declaring done. Do NOT commit secrets.

## 1. Repo-root `.env` (gitignored — never commit, never print the token in full)
Ensure `~/dev/jarvis/fleet-mission-control/.env` exists with these keys. The `mac-cockpit` token is
in the gitignored `./.fleet-secrets.env` as `FLEET_TOKEN_MAC_COCKPIT` — copy that value into
`FLEET_TOKEN` (read it from that file; don't hardcode it in any tracked file):
```
FLEET_TOKEN=<value of FLEET_TOKEN_MAC_COCKPIT from ./.fleet-secrets.env>
FLEET_INGEST_URL=https://sbmsxerwgylpfkkkjtku.supabase.co/functions/v1/ingest
FLEET_COMMANDS_URL=https://sbmsxerwgylpfkkkjtku.supabase.co/functions/v1/commands
FLEET_HEARTBEAT_INTERVAL_S=10
FLEET_POLL_INTERVAL_S=4
FLEET_COCKPIT_LOG_DIR=~/cockpit-logs
FLEET_MACHINE_NAME=mac-cockpit
COCKPIT_SH=~/dev/jarvis/portfolio/cockpit.sh
WIN_HOST=<the sentry ssh target cockpit.sh uses>
```
Discover `WIN_HOST` from the user's environment (`echo $WIN_HOST`, or grep `~/.zshrc ~/.bashrc
~/.profile` for `WIN_HOST`/`cockpit`). If you can't find it, STOP and ask the human. `chmod 600 .env`.
Confirm `.env` is gitignored (`git check-ignore .env`).

## 2. Smoke-test both processes before installing services
- `node --env-file=.env index.mjs --once` → expect a heartbeat `ok`.
- `node --env-file=.env agent/index.mjs --once` → it should poll, find no pending command, exit cleanly.
If either fails, fix/report before continuing.

## 3. Install launchd services (reporter + agent)
Use the units in `deploy/launchd/` (`com.fleet.reporter.plist`, `com.fleet.agent.plist`) as the base.
They must: run the ABSOLUTE node path (`command -v node` — the user's node may be via nvm/homebrew),
`--env-file=.env`, `WorkingDirectory` = the repo, `RunAtLoad` + `KeepAlive`, and write stdout/stderr
to `/tmp/fleet-reporter.*.log` / `/tmp/fleet-agent.*.log`. Edit the plists accordingly (don't invent
a different scheme than the repo's), copy to `~/Library/LaunchAgents/`, and `launchctl load` both.
Verify with `launchctl list | grep fleet` and by tailing the logs for a heartbeat + a poll line.

## 4. Validate, then STOP and report
- Both services loaded and logging; a fresh heartbeat is going out (so `mac-cockpit` shows online).
- The agent is polling (ready to claim a dispatched command).
- Report what's running, the log paths, and how to stop/restart. Do NOT commit `.env` or
  `.fleet-secrets.env`. If you changed the plist files in `deploy/launchd/`, leave them staged for the
  human to commit (those are tracked, no secrets in them) and say so.

Do not begin until I confirm.
