# Fleet completion hook (Phase D, F2-a — the loop-closer source event)

One per-machine Claude Code hook that fires on the completion of **every** Code
session — headless `cg run`, interactive `cg runi`, and local Mac sessions — in
**every** project, with **zero per-project setup**. On fire it:

1. **Pushes to the human** — desktop banner **+ ntfy-over-Tailscale** — carrying the
   session's final message + project/branch + the `/rc` link if the session had one
   (tap-to-resume composes with Phase B).
2. **Writes a completion record into the fleet bus** — POSTs to `ingest` with this
   machine's reporter token so Cowork can read that a session finished + its result.

Backstop (already built, not here): the reporter's tmux-disappear detection still
marks crashed/killed sessions `finished` in the bus — without the rich message —
since hooks don't fire on a hard kill. The **human push comes only from the hook**,
so there's no double-notify.

## Files
| File | What |
|---|---|
| `fleet-notify.sh` | The hook. Zero-dep (`bash`+`curl`+`jq`), fail-soft, always exits 0. |
| `install-fleet-hook.sh` | Once-per-machine installer (writes config, prints/【--apply】merges settings). |
| `hook.env.example` | Template for the machine-level config (placeholders only). |
| `settings.snippet.json` | The `~/.claude/settings.json` hook block to paste. |

## Events
- **`SessionEnd`** — the completion signal (fires once per session, headless +
  interactive; `Stop` fires every turn interactively → too noisy). → push **and**
  a bus POST marking the session `finished` with its final message + `/rc` URL.
- **`Notification`** (matched to `permission_prompt|idle_prompt`) — a "needs you"
  ping when Claude is waiting for input/permission. → push **only**, no bus row.

Neither event carries the final message inline (verified against
`code.claude.com/docs/en/hooks` + a live transcript). The script reads the last
assistant text block from the session's `transcript_path` (JSONL).

## Install (once per machine — Mac + sentry)
```sh
# Fill the secret + token from this machine's env so they never touch the repo:
NTFY_TOPIC=fleet-<real-topic> FLEET_TOKEN=<this-machine's reporter token> \
  bash deploy/hooks/install-fleet-hook.sh           # prints the settings snippet
# Then paste the printed block into ~/.claude/settings.json, OR auto-merge it:
NTFY_TOPIC=... FLEET_TOKEN=... bash deploy/hooks/install-fleet-hook.sh --apply
```
- Config lands at `~/.config/fleet/hook.env` (chmod 600, **outside** the repo).
- Reuse the machine's **existing** reporter token (Mac: `FLEET_TOKEN_MAC_COCKPIT`,
  sentry: `FLEET_TOKEN_SENTRY` from `.fleet-secrets.env`) — do **not** mint a new one.

## Verify
```sh
tail -f ~/.fleet/hook.log         # every fire logs here (push/POST results)
# End any Claude session → desktop banner + ntfy push; SessionEnd also POSTs the bus.
```

## Bus POST contract (coordinate with F2-b `bus`)
```json
{ "jobs": [ { "name": "<tmux/session name>", "project": "<repo>",
             "kind": "claude-session", "status": "finished", "ended_at": "<iso>",
             "last_message": "<final assistant text>", "rc_url": "<.../rc if known>" } ] }
```
`status:"finished"` is public (`fleet_jobs`); `last_message` + `rc_url` are sensitive
→ routed to private `fleet_job_links`. **Pending in `bus`:** the `last_message`
column does not exist yet, and `ingest` matches existing rows by `status='running'`
so a `finished` POST currently inserts a *new* row (idempotency fix is F2-b's). The
hook is correct against the agreed contract; DB-side confirmation of `last_message`
is deferred to the migration.
