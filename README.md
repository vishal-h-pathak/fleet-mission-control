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
docs/            BRIEF.md (design + changelog), SCHEMA.md (P0 data model)
supabase/
  migrations/    P0 schema, RLS+grants, realtime, retention, token helpers (APPLIED)
  functions/
    ingest/      Edge Function: token-authed write-only telemetry sink
web/             Next.js dashboard (P0)        — TODO
reporter/        standalone Node agent per machine — TODO
```

## Status — 2026-06-21

- ✅ **Supabase P0 schema applied** (shared project `sbmsxerwgylpfkkkjtku`, `fleet_`-prefixed).
- ✅ **`ingest` Edge Function deployed** (per-machine bearer-token auth, service-role writes).
- ✅ Security split: public read surface + private (`fleet_machine_secrets`, `fleet_job_links`).
- ⏳ Reporter agent (Node) — next.
- ⏳ Dashboard (Next.js, realtime, phone-responsive) — next.

## Decisions locked (2026-06-21)

| | |
|---|---|
| Name | **Fleet Mission Control** |
| Plan | On **Max** → `/rc` depth layer available |
| Access | **Public shell + authed controls** |
| Reporter | **Standalone Node agent** (own service per machine; not the Python env) |
| Data | **Shared** portfolio Supabase project (org at 2-free-project cap), `fleet_`-prefixed |

## Local setup (when web/ + reporter/ land)

1. `cp .env.example .env.local` (web) / `.env` (reporter); fill secrets.
2. Register each machine: `select public.fleet_register_machine('<name>','<kind>');` → put
   the one-time token in that machine's reporter `.env` as `FLEET_TOKEN`.
3. Run the reporter on Mac + `sentry`; open the dashboard.
