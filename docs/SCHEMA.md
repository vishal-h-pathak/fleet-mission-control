# Fleet Mission Control — P0 data model

> Source of truth for the P0 (monitoring) schema. Lives in the **shared** Supabase
> project `sbmsxerwgylpfkkkjtku` (`vishal-h-pathak's Project`), `fleet_`-prefixed to
> coexist with the portfolio's job-hunter tables. Migrations: `supabase/migrations/`.
> Status: **applied 2026-06-21.**

## Security model — "public shell + authed controls", enforced in the DB

Two surfaces, split at the table level so the dashboard's public/authed boundary is a
property of the data, not just the UI:

| Surface | Tables | Who can read | How |
|---|---|---|---|
| **Public** | `fleet_machines`, `fleet_heartbeats`, `fleet_jobs`, `fleet_machine_status` (view) | anon + authenticated | RLS `SELECT` policies `using (true)`; in the realtime publication |
| **Private** | `fleet_machine_secrets`, `fleet_job_links` | nobody via the API | RLS enabled, **zero policies** → deny-all; only `service_role` (ingest fn / authed API routes) bypasses |

- **Writes:** no table has an anon/authenticated write policy. All writes go through the
  `ingest` Edge Function using the service role. The web app can never write directly.
- **The `/rc` URL is a capability.** Anyone holding it can drive a live Claude Code
  session, so `rc_url`/`rc_qr` live in `fleet_job_links` (private) — surfaced only to an
  authed viewer via a service-role API route, never on the public dashboard.
- The "RLS enabled, no policy" linter notice on the two private tables is **intended**.

## Tables

### `fleet_machines` — node registry (public)
`id` uuid pk · `name` unique · `kind` (cockpit|compute|phone|node) · `os` · `arch` ·
`specs` jsonb · `agent_version` · `created_at` · `last_seen_at`. No secrets.

### `fleet_machine_secrets` — per-machine auth (private)
`machine_id` pk→machines · `token_hash` (sha256 hex, unique) · `tailscale_ip` ·
`created_at` · `rotated_at`.

### `fleet_heartbeats` — telemetry time-series (public, append-only)
`id` bigint identity · `machine_id`→machines · `ts` · `cpu_pct` · `ram_pct` ·
`ram_used_mb` · `ram_total_mb` · `load_avg` real[] · `gpu` jsonb · `uptime_s` ·
`schema_version` · `raw` jsonb. Indexed `(machine_id, ts desc)`. Pruned >48h every 30m
via `pg_cron` job `fleet_prune_heartbeats`.

### `fleet_jobs` — what's running (public, safe columns only)
`id` uuid pk · `machine_id`→machines · `name` (tmux session) · `project` ·
`kind` (evolution|claude-session|nav|other) · `status` (running|finished|failed|stopped|unknown) ·
`started_at` · `ended_at` · `updated_at` · `progress` jsonb · `exit_code`.
Partial unique `(machine_id, name) where status='running'` → one active job per name.

### `fleet_job_links` — sensitive job detail (private)
`job_id` pk→jobs · `rc_url` · `rc_qr` · `cmd` (full directive) · `metrics_url` ·
`log_tail` · `updated_at`.

### `fleet_machine_status` — view (public, `security_invoker`)
Each machine joined to its latest heartbeat + derived `status`:
`online` (<30s), `stale` (<2m), else `offline`.

## Heartbeat / ingest contract (schema_version = 1)

The contract — not the reporter's language — is the stable interface. Reporters POST to
the `ingest` function with `Authorization: Bearer <machine-token>`:

```json
{
  "machine":   { "os": "...", "arch": "...", "specs": {...}, "agent_version": "..." },
  "heartbeat": { "cpu_pct": 0, "ram_pct": 0, "ram_used_mb": 0, "ram_total_mb": 0,
                 "load_avg": [0,0,0], "gpu": [{"index":0,"name":"...","util_pct":0,
                 "mem_used_mb":0,"mem_total_mb":0,"temp_c":0,"power_w":0}],
                 "uptime_s": 0, "raw": {} },
  "jobs":      [ { "name": "nav", "project": "cellular-gaits", "kind": "nav",
                   "status": "running", "progress": {"gens_done":0,"gens_total":0,
                   "best_fitness":0,"eta_s":0}, "rc_url": "...", "cmd": "..." } ]
}
```

`ingest` validates the token (sha256 → `fleet_machine_secrets`), updates `last_seen_at`,
inserts a heartbeat, and upserts each job (public fields → `fleet_jobs`, sensitive fields
→ `fleet_job_links`).

## Bootstrapping a machine

Register (or rotate) with the service role; the plaintext token is shown **once**:

```sql
select public.fleet_register_machine('mac-cockpit', 'cockpit');
select public.fleet_register_machine('sentry', 'compute', '100.86.154.46');
```

Put the returned token in that machine's reporter config as `FLEET_TOKEN` (treat as a
secret). Rotating re-runs the same call.

## Endpoints
- Project URL: `https://sbmsxerwgylpfkkkjtku.supabase.co`
- Ingest: `POST https://sbmsxerwgylpfkkkjtku.supabase.co/functions/v1/ingest`
- Publishable (anon) key: dashboard read-only; see `.env.example`.
