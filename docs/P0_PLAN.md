# Fleet Mission Control — P0 build plan (wave 1)

> How P0 gets built: parallel Claude Code sessions, one per work package, staged by
> `setup-fleet-p0-wave1.sh`. The data layer (schema + `ingest`) is already live — see
> `docs/SCHEMA.md`. This doc is the DAG + acceptance criteria. Date: 2026-06-21.

## Deploy model (decided)
Dashboard is a **standalone Next.js app** in `web/`, its own Vercel project at
`fleet.vishal.pa.thak.io`, **linked from the portfolio** (nav link + optional `/fleet`
rewrite). Self-contained, but reachable from the site. (Alternative if preferred later:
fold it in as a `/fleet` route inside the portfolio app.)

## Dependency graph
The bus is live, so all three wave-1 packages are **independent and run in parallel** —
disjoint folders/repos, separate branches, no git collisions:

```
            ┌─────────────────────────────────────────────┐
   (DONE)   │  Supabase: schema + RLS + ingest fn + tokens │
            └──────────────────────┬──────────────────────┘
                                   │ frozen contract (schema_version 1)
        ┌──────────────────────────┼──────────────────────────┐
        ▼                          ▼                          ▼
   F1 Reporter (Node)        F2 Dashboard (Next.js)     F3 Portfolio link
   feat/fleet-p0-reporter    feat/fleet-p0-dashboard    feat/fleet-portfolio-link
        └──────────────────────────┴──────────────────────────┘
                                   │
                                   ▼   wave 2 (human-driven, separate launcher)
                     verify end-to-end → deploy F2 to Vercel → merge branches
```

Nothing in wave 1 must run serially. Verification/deploy/merge is wave 2.

## Work packages

### F1 — Reporter agent  (`reporter/`)
Standalone Node service per machine (own systemd/launchd unit; **not** the cellular
Python env). Builds a `schema_version: 1` heartbeat (see `docs/SCHEMA.md` contract) and
POSTs to `ingest` with `Authorization: Bearer $FLEET_TOKEN` every `FLEET_HEARTBEAT_INTERVAL_S`.
- Host metrics: CPU %, RAM used/total/%, load avg, uptime. GPU via `nvidia-smi`
  (`sentry`); degrade gracefully to no-GPU (Mac).
- Jobs: parse `tmux ls` + `~/cockpit-logs/*.log`; one job per session; map to
  `fleet_jobs` fields; best-effort progress regex (gens/fitness) into `progress`; last
  log line → `log_tail` (private). `/rc` URL passthrough if present in a sidecar file.
- `--dry-run` prints the payload without sending. launchd (Mac) + systemd (`sentry`/WSL) units.
- **Accept:** dry-run prints valid JSON; live post returns `{ok:true}`; a row lands in
  `fleet_heartbeats`; no-GPU path works; README covers `fleet_register_machine` + token.

### F2 — Dashboard  (`web/`)
Next.js (match portfolio: Next 16.2.3, React 19, Tailwind 4, `@supabase/supabase-js ^2.49`).
- **Public** (anon key, read-only): machine cards (online/stale/offline from
  `fleet_machine_status`, CPU/RAM/GPU), active-jobs list with progress/latest fitness.
  Supabase **realtime** subscription; **phone-responsive** (verify at 390px).
- **Authed** (password → signed cookie, middleware): a **server** route using the service
  role to return `fleet_job_links` (`rc_url`/QR) for a job. Public surface NEVER exposes
  `rc_url`. This is the P0 expression of "authed controls".
- **Accept:** `npm run build` green; cards + jobs render and update live; mobile layout
  clean; authed route gated (401 without cookie, returns `rc_url` with it); Vercel config ready.

### F3 — Portfolio link  (`portfolio`)
- Add a "Fleet" nav entry → the Fleet app URL (env/config-driven); optional `next.config`
  rewrite `/fleet` → fleet app. **Accept:** portfolio `npm run build` green; link present.

## Conventions every session follows
See `prompts/PROMPT_fleet_conventions.md` — frozen DB contract, security rules (no secrets
on the public surface), branch hygiene, validation-first, and "do not begin until I confirm."

## Launch
From the fleet repo root on the Mac:
```
bash setup-fleet-p0-wave1.sh
```
Stages three Terminal tabs with directives pasted-but-unsent. Review each, press Return.
Teardown notes are printed by the script.
