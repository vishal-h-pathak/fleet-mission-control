# Fleet Mission Control

One web interface on `vishal.pa.thak.io` — a single pane of glass over every machine
(Mac cockpit, `sentry` workstation, phone, future nodes): see what's running everywhere,
view logs/metrics, and dispatch/steer work from any device, including mobile.

Read **`ONBOARDING.md`** then **`docs/BRIEF.md`** for the full picture.

## Architecture (one paragraph)

A **two-layer** model. *Depth* is Anthropic's Claude Code `/remote-control` (`/rc`) —
already bridges a running session to web + mobile; we don't rebuild it. *Breadth* is what
this project adds: machines **push** heartbeats/job-status to a **Supabase** message bus
(no inbound ports — they live behind Tailscale), a phone-responsive **dashboard** reads it
in realtime, and launching work runs through the existing `cockpit.sh`. The join: the
dashboard surfaces each job's `/rc` URL so you tap a job on your phone and drop into the
live session. Build order: **P0 monitoring (read-only)** → logs/metrics → **control plane
last, behind real auth.**

## Layout

```
index.mjs        Reporter agent (Node, zero deps)
deploy/
  launchd/       com.fleet.reporter.plist (macOS)
  systemd/       fleet-reporter.service (Linux/WSL)
docs/            BRIEF.md (design + changelog), SCHEMA.md (P0 data model)
supabase/
  migrations/    P0 schema, RLS+grants, realtime, retention, token helpers (APPLIED)
  functions/
    ingest/      Edge Function: token-authed write-only telemetry sink
```

## Status — 2026-06-21

- ✅ **Supabase P0 schema applied** (shared project `sbmsxerwgylpfkkkjtku`, `fleet_`-prefixed).
- ✅ **`ingest` Edge Function deployed** (per-machine bearer-token auth, service-role writes).
- ✅ Security split: public read surface + private (`fleet_machine_secrets`, `fleet_job_links`).
- ✅ **Reporter agent** (`index.mjs`) — validated against live ingest.
- ⏳ Dashboard (Next.js, realtime, phone-responsive) — next.

## Decisions locked (2026-06-21)

| | |
|---|---|
| Name | **Fleet Mission Control** |
| Plan | On **Max** → `/rc` depth layer available |
| Access | **Public shell + authed controls** |
| Reporter | **Standalone Node agent** (own service per machine; not the Python env) |
| Data | **Shared** portfolio Supabase project (org at 2-free-project cap), `fleet_`-prefixed |

## Reporter — quick start

Standalone Node heartbeat agent. Zero npm deps. Requires **Node 18+** (uses `fetch`, ESM).

### 1. Register the machine (one-time, from Supabase SQL editor)

```sql
select public.fleet_register_machine('mac-cockpit', 'cockpit');
-- or
select public.fleet_register_machine('sentry', 'compute', '100.86.154.46');
```

Returns a plaintext token **shown once**. Copy it immediately — only the SHA-256
hash is stored. To rotate, re-run the same call.

### 2. Configure

Create `.env` (gitignored):

```env
FLEET_TOKEN=<the token from step 1>
FLEET_INGEST_URL=https://sbmsxerwgylpfkkkjtku.supabase.co/functions/v1/ingest
FLEET_HEARTBEAT_INTERVAL_S=10
FLEET_COCKPIT_LOG_DIR=~/cockpit-logs
FLEET_MACHINE_NAME=mac-cockpit
```

**Never commit `.env` or the token.** See `.env.example` for the template.

### 3. Test

```bash
# Dry run — prints the payload without sending
node index.mjs --dry-run

# Single heartbeat against live ingest
node index.mjs --once
```

### 4. Run as a service

**macOS (launchd)** — edit `deploy/launchd/com.fleet.reporter.plist` (update
node path, script path, `FLEET_TOKEN`), then:

```bash
cp deploy/launchd/com.fleet.reporter.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.fleet.reporter.plist
launchctl list | grep fleet
tail -f /tmp/fleet-reporter.stdout.log
```

**Linux / WSL2 (systemd)** — copy reporter to `/opt/fleet/reporter/`, create
`.env` there, then:

```bash
sudo cp deploy/systemd/fleet-reporter.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now fleet-reporter
journalctl -u fleet-reporter -f
```

### What it collects

| Field | Source | Notes |
|-------|--------|-------|
| CPU % | `os.cpus()` | Aggregate across all cores |
| RAM | `os.totalmem() / freemem()` | MB + percent |
| Load avg | `os.loadavg()` | 1, 5, 15 min |
| GPU | `nvidia-smi` | Empty array if not present (Mac) |
| Uptime | `os.uptime()` | Seconds |
| Jobs | `tmux ls` | Each session = one job |
| Log tail | `$LOG_DIR/<name>.log` | Last 20 lines (PRIVATE — `fleet_job_links`) |
| Progress | Regex on log tail | `gens_done`, `gens_total`, `best_fitness` |
| RC URL | `$LOG_DIR/<name>.rc` | First line (PRIVATE — `fleet_job_links`) |

### Job classification

| tmux session | `kind` | `project` |
|---|---|---|
| `nav` | `nav` | `cellular-gaits` |
| `claude-HHMMSS` | `claude-session` | — |
| `evolution` / `evo` | `evolution` | `cellular-gaits` |
| anything else | `other` | — |

### Finished-job detection

When a previously-seen tmux session disappears, the reporter sends one final
heartbeat with `status: "finished"` (or `"failed"` if the log tail contains
error/traceback/panic/fatal). Simple and intentionally conservative.

### Progress regex coverage (stub notes)

Currently matches:
- `gen 150/500` or `generation 150/500` → `gens_done`, `gens_total`
- `best_fitness: 0.85` / `best fit: 0.85` / `best_fit=0.85` → `best_fitness`

Not yet covered: ETA extraction, per-generation timing, W&B run URLs.
