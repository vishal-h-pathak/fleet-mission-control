# Operationalize sentry (reporter as a systemd service)

> Hand this to a Claude Code session opened in `~/dev/jarvis/fleet-mission-control` ON SENTRY (WSL).
> Goal: replace the hand-run tmux reporter with a persistent systemd service that survives reboots.
> (The control agent on sentry is optional for now — sentry-local verbs aren't in the allowlist yet;
> skip it unless asked.) Use judgment; validate before declaring done. Do NOT commit secrets.

## 1. Pull + verify config
- `git pull` (get the latest reporter).
- `~/dev/jarvis/fleet-mission-control/.env` should already exist from bootstrap with the SENTRY token
  (`FLEET_MACHINE_NAME=sentry`). Verify `node --env-file=.env index.mjs --once` returns a heartbeat
  `ok`. If `.env` is missing, recreate it (the sentry token is in `./.fleet-secrets.env` as
  `FLEET_TOKEN_SENTRY`; never commit it).

## 2. Install the systemd service
Base it on `deploy/systemd/fleet-reporter.service`. Set: `WorkingDirectory` = the repo,
`EnvironmentFile` = `<repo>/.env`, `ExecStart` = `<absolute node path> <repo>/index.mjs`
(node is via nvm — use the real path from `command -v node`; systemd as root won't have nvm on PATH),
`User=<your user>`, `Restart=always`. Then:
```
sudo cp deploy/systemd/fleet-reporter.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now fleet-reporter
journalctl -u fleet-reporter -f   # confirm heartbeats
```

## 3. WSL systemd caveat (handle it)
If `systemctl` errors with "System has not been booted with systemd", systemd isn't enabled in this
WSL distro. Enable it: add `[boot]\nsystemd=true` to `/etc/wsl.conf`, then tell the human to run
`wsl --shutdown` from Windows PowerShell and reopen WSL (you cannot do that from inside WSL). After
that, re-run step 2. If enabling systemd is undesirable, fall back to a detached tmux loop
(`tmux new -d -s fleet-reporter 'cd <repo> && node --env-file=.env index.mjs'`) and say so plainly.

## 4. Avoid double-reporting + validate
- Stop the old hand-run tmux reporter if one is still running (`tmux kill-session -t fleet-reporter`
  only if you've started the systemd one; don't kill the service's own session).
- Confirm exactly one reporter is sending heartbeats (so `sentry` shows online, not flapping).
- Report status, the journal command, and any human follow-up (e.g. the `wsl --shutdown`). Do NOT
  commit `.env` / `.fleet-secrets.env`; leave any edited tracked unit files staged for the human.

Do not begin until I confirm.
