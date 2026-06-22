# F1 — Reporter agent (P0)

Build the **standalone Node reporter** that runs on each machine (Mac cockpit + `sentry`)
and pushes telemetry to the Fleet `ingest` Edge Function. Read
`prompts/PROMPT_fleet_conventions.md` first. Branch: `feat/fleet-p0-reporter`. Folder: `reporter/`.

## Goal
A small, dependency-light Node service that, every `FLEET_HEARTBEAT_INTERVAL_S` (default 10s),
collects host + job state and POSTs one heartbeat to `ingest` with a per-machine bearer token.
It must run on macOS (Mac) and Linux/WSL2 (`sentry`). No Python.

## Build the heartbeat to the FROZEN contract
Conform exactly to `docs/SCHEMA.md` → "Heartbeat / ingest contract (schema_version = 1)".
POST `https://sbmsxerwgylpfkkkjtku.supabase.co/functions/v1/ingest` with header
`Authorization: Bearer ${FLEET_TOKEN}` and JSON body `{ machine, heartbeat, jobs }`.
A `{ ok: true }` response means success; log non-200s with the response body.

## Host metrics
- CPU % (overall), RAM used/total MB + %, load average `[1,5,15]`, uptime seconds, OS, arch.
  Prefer Node built-ins (`os`) + light parsing; you MAY use `systeminformation` if it keeps
  the code clean — keep deps minimal and justify in the README.
- **GPU:** parse `nvidia-smi --query-gpu=index,name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw --format=csv,noheader,nounits`
  into the `gpu` array. If `nvidia-smi` is absent (Mac), set `gpu: []` and continue — never crash.
- Populate `machine.specs` once (cpu model/cores, ram_total_mb, gpu names) and `agent_version`.

## Job state
- List `tmux` sessions (`tmux ls`); for each, emit a job. Mirror the cockpit convention:
  session `nav` → `kind: "nav"`, project `cellular-gaits`; sessions like `claude-HHMMSS` →
  `kind: "claude-session"`; else `kind: "other"`.
- Read the matching `${FLEET_COCKPIT_LOG_DIR}/<name>.log` (default `~/cockpit-logs`):
  - `log_tail` = last ~20 lines (PRIVATE — goes to `fleet_job_links`, never public).
  - Best-effort `progress` regex: pull generation/fitness numbers if present
    (e.g. `gen (\d+)/(\d+)`, `best[_ ]?fit\w*[:= ]+([\d.]+)`) into
    `{gens_done, gens_total, best_fitness, ...}`. If nothing parses, leave `progress: {}`.
  - When a tmux session referenced by a recent log disappears, report that job once with
    `status: "finished"` (or `failed` if the log's tail indicates an error) so the
    dashboard can close it. Keep this heuristic simple and documented.
- **`/rc` URL passthrough (the join to the depth layer):** if a sidecar file
  `${FLEET_COCKPIT_LOG_DIR}/<name>.rc` exists, read its first line as `rc_url` and include
  it on that job (PRIVATE). This lets a launched session advertise its remote-control URL.

## Config (env; update `.env.example` if you add any)
`FLEET_TOKEN`, `FLEET_INGEST_URL`, `FLEET_HEARTBEAT_INTERVAL_S`, `FLEET_COCKPIT_LOG_DIR`,
plus an optional `FLEET_MACHINE_NAME` for logging. Never commit real values.

**Tokens are already provisioned.** A gitignored `./.fleet-secrets.env` (copied into this
worktree by the launcher) holds the live values:
- `FLEET_INGEST_URL`, `NEXT_PUBLIC_SUPABASE_URL`, anon key (non-secret).
- `FLEET_TOKEN_MAC_COCKPIT` and `FLEET_TOKEN_SENTRY` — the per-machine write tokens (SECRET).
For local testing on the Mac, create a gitignored `reporter/.env` with
`FLEET_TOKEN=<value of FLEET_TOKEN_MAC_COCKPIT>` and `FLEET_INGEST_URL` from that file; on
`sentry`, use `FLEET_TOKEN_SENTRY`. Never copy these tokens into committed files or `.env.example`.

## Ship
- `--dry-run` flag: collect and pretty-print the payload to stdout, do NOT send.
- `--once` flag: send a single heartbeat and exit (for testing).
- Service units: `reporter/deploy/launchd/com.fleet.reporter.plist` (Mac) and
  `reporter/deploy/systemd/fleet-reporter.service` (Linux/WSL), with install notes.
- `reporter/README.md`: how to register a machine
  (`select public.fleet_register_machine('<name>','<kind>');` → token), set env, run, install
  the service. Be explicit that the token is a secret shown once.

## Acceptance (validate, then STOP and report)
1. `node reporter --dry-run` prints a contract-valid payload (machine + heartbeat + jobs).
2. `node reporter --once` against the live `ingest` returns `{ok:true}` and a row appears in
   `fleet_heartbeats` (confirm via the human / Supabase).
3. No-GPU path works on the Mac (empty `gpu`, no crash).
4. README + service units present. Report what's real vs. stubbed (e.g. progress regex
   coverage) before finalizing.

Do not begin until I confirm.
