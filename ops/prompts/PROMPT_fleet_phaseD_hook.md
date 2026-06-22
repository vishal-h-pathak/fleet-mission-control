# Phase D — Completion hook + human push (F2-a, the loop-closer source event)

> PHASE D, feature F2-a. Read `ops/prompts/PROMPT_fleet_conventions.md` first. Branch:
> `feat/fleet-phaseD-hook`. Fleet repo only (`deploy/` + `docs/` + `.env.example`) — no portfolio,
> no schema. The bus-side ingestion (the `ingest`/schema change this hook POSTs to) is the **sibling
> F2-b `bus` session**; build to the contract below and coordinate on it. Full design:
> `docs/LOOP_CLOSER.md`; build order: `docs/CONTROL_LOOP_PLAN.md`.

## Goal
A **Claude Code hook installed once per machine** (Mac + `sentry`) that fires on completion of **every**
Code session — headless `cg run`, interactive `cg runi`, and local Mac sessions — in **every project,
with zero per-project setup**. On fire it does two things:
1. **Push to the human** — desktop banner **+ ntfy-over-Tailscale** (decided channel), carrying the
   session's final message + cwd/branch + the `/rc` link if present (tap-to-resume composes with Phase B).
2. **Write a completion record into the fleet bus** — POST to `ingest` with the machine's reporter
   token (see contract below) so Cowork can read it.

Build our own thin hook script (recommended) — off-the-shelf tools (`claude-notifications-go`,
`code-notify`) only do the human push, not the bus write. Zero-dep: POSIX `sh`/`bash` + `curl` + `jq`.

## ntfy instance — ALREADY PROVISIONED, do not stand one up
A self-hosted ntfy server is live on `sentry` (systemd, on the tailnet) and verified reachable from
the Mac over Tailscale. Point the hook at it; do **not** install or configure ntfy.
- **Base URL:** `http://100.86.154.46:8080`
- **Topic:** `fleet-<secret-topic>` — treat as a **secret/capability** (anyone holding it can
  read session output). Keep it in the gitignored machine env only; never commit the real value.
- Publish shape (what the hook does): `curl -d "<msg>" http://100.86.154.46:8080/<topic>` (add
  `-H "Title: ..."`, `-H "Click: <rc_url>"`, `-H "Tags: ..."` as useful). Verify against the live topic.

## Hook events (decided)
- **`SessionEnd`** = the completion signal (fires once per session, headless + interactive; `Stop`
  fires every turn interactively → too noisy). This is what triggers push + bus-write.
- **`Notification`** = a separate "needs you" ping (Claude waiting for input/permission) — e.g. a
  `cg runi` session paused at its STOP gate. Push only (no bus completion record). Keep it lightweight
  and clearly distinct from "done".
- Confirm the real hook JSON shape first (`code.claude.com/docs/en/hooks-guide`): `SessionEnd` input
  carries `last_assistant_message` (the final text) + cwd/session id; build the script around the
  actual fields, don't guess.

## The script + install
- `deploy/hooks/fleet-notify.sh` (or similar): reads the hook JSON on stdin, extracts
  `last_assistant_message`, cwd, git branch (`git -C <cwd> rev-parse --abbrev-ref HEAD`), tmux session
  name if any, and the `/rc` URL if discoverable (the session's `$LOG_DIR/<name>.rc` sidecar, reused
  from Phase B). Then: desktop notify (`osascript` on macOS / `notify-send` on `sentry`) + `curl` the
  ntfy topic + `curl` the bus POST. Fail soft — a hook must never block or error the session; swallow
  push/network failures and log to a local file.
- A committed **install script** + a `~/.claude/settings.json` snippet (documented, not auto-edited
  blindly) that registers the `SessionEnd` + `Notification` hooks **at the machine/user level** so
  every project inherits them. Install once per machine; show the user the snippet to confirm.
- Config via env (machine-level, gitignored): `NTFY_BASE_URL=http://100.86.154.46:8080`,
  `NTFY_TOPIC=fleet-<secret-topic>` (secret — placeholder only in `.env.example`), the
  reporter `FLEET_TOKEN` (reuse the machine's existing reporter token — do NOT mint a new secret),
  `INGEST_URL`. Update `.env.example` with the key names + placeholders, never the real topic/token.

## Bus POST contract (coordinate with F2-b `bus`)
POST to `ingest` (`Authorization: Bearer <FLEET_TOKEN>`) a normal heartbeat-shaped body whose `jobs[]`
entry marks the session finished and carries the message **as a private field**:
```json
{ "jobs": [ { "name": "<tmux/session name>", "project": "<repo>", "kind": "claude-session",
             "status": "finished", "ended_at": "<iso>",
             "last_message": "<last_assistant_message>", "rc_url": "<.../rc if known>" } ] }
```
Per the public/private split: `status:"finished"` is public (`fleet_jobs`); `last_message` + `rc_url`
are sensitive → the `bus` session routes them to **private** `fleet_job_links` (and adds the
`last_message` column). If `bus` hasn't landed yet, still send the POST — it's idempotent once `bus`
fixes the finished-row matching; note in your report that the field is pending the schema change.

## Acceptance (validate, then STOP and report)
1. A real local Mac Code session ending fires `SessionEnd` → a desktop banner **and** an ntfy push
   appear, both carrying the final message (+ `/rc` link if the session had one).
2. A `Notification` event (session waiting) fires a distinct "needs you" push, no bus completion row.
3. The bus POST is sent with the machine token (show the request shape); confirm a finished record can
   land (full DB confirmation is joint with `bus`). Hook failures never break or hang the session
   (demonstrate: kill ntfy / unset the URL → session still completes cleanly).
4. Install is once-per-machine, machine-level, zero per-project setup; `.env.example` updated; no
   secret committed. Report what's tested on Mac vs. deferred to `sentry`, and the exact hook JSON
   fields you relied on.

Do not begin until I confirm.
