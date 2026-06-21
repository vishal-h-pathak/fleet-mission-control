# Fleet Mission Control — P1 + P2 build plan (logs/metrics → control plane)

> The next two phases, scaffolded so building is "run the next script." Same pattern as P0:
> the planner (Claude in Cowork) owns Supabase schema + the `ingest` function via connector;
> parallel Claude Code sessions build the code; you run exact commands per machine.
> Data layer for P1 is already applied. Date: 2026-06-21.

## Run order (top → bottom)

```
PREREQ  ── bring sentry online (reporter) ............ scripts/sentry-bootstrap.sh   [on sentry]
P1      ── logs + metrics in the dashboard
          A reporter: emit metric points ............. PROMPT_fleet_p1_reporter_metrics.md
          B dashboard: sparkline + authed log view ... PROMPT_fleet_p1_dashboard.md
          launch both (Mac) ........................ setup-fleet-p1-wave.sh
          → gauge in the live dashboard, iterate
P2      ── control plane (authed command queue)        [planner applies schema first]
          A control agent (per machine) ............. PROMPT_fleet_p2_control_agent.md
          B dashboard: authed dispatch UI ........... PROMPT_fleet_p2_dashboard_dispatch.md
          launch (Mac) ............................. setup-fleet-p2-wave.sh
          agent on each machine .................... scripts/sentry-bootstrap.sh --agent  [+ Mac]
```

## PREREQ — bring sentry online
P1 and P2 both need a live agent on `sentry`. The finished run's data is in a log file on
`sentry`, not yet in the bus. Run `scripts/sentry-bootstrap.sh` on `sentry` (WSL) — it clones
the repo, writes `.env` with the `sentry` token, sends a test heartbeat, and (optionally)
installs the systemd service so the card stays live. See that script's header for usage.

> Note: the reporter scrapes *currently-running* tmux sessions, so an already-finished run won't
> auto-appear. To get a finished run into the dashboard, re-run it under `tmux` (even briefly) or
> use the reporter's `--import-log <name>` path added in P1-A.

## P1 — logs & metrics (DATA LAYER ALREADY APPLIED)
Applied to Supabase (migration `fleet_p1_job_metrics`, `ingest` v3):
- **`fleet_job_metrics`** (public): `job_id, ts, gen, best_fitness, mean_fitness, extra`.
  Realtime-enabled; idempotent on `(job_id, gen)`.
- **`ingest`** now accepts `jobs[].metrics: [{gen,best_fitness,mean_fitness,ts?,extra?}]`.

Build (two parallel sessions):
- **A — reporter metrics** (`index.mjs`): parse per-generation fitness from the job log and emit
  `metrics` points (only new generations since last send); add `--import-log <name>` to backfill a
  finished run's whole curve in one shot. Keep `log_tail` (private) as-is.
- **B — dashboard** (`web/`): a public **fitness sparkline** per job from `fleet_job_metrics`
  (realtime), and an **authed log view** (reads `fleet_job_links.log_tail` via a service-role route
  behind the existing cookie — logs can leak content, so they stay gated).

## P2 — control plane (planner applies schema at the start of this phase)
Planned schema (NOT yet applied — applied when P2 starts):
- **`fleet_commands`**: `id, machine_id, verb, args jsonb, status (pending|claimed|running|done|error|rejected),
  requested_by, created_at, claimed_at, finished_at, result jsonb, exit_code`.
- RLS: **no anon access at all.** Inserts only via an authed server route (service role). Each
  machine's agent reads/updates only its own rows (via service role in the agent, or a scoped token).
- Strict **verb allowlist** (`fetch-log`, `pull`, `artifact`, `start-run`, `stop`, …) — the agent
  maps verbs → `cockpit.sh` primitives with validated args. **Never arbitrary shell from the web.**

Build:
- **A — control agent** (`agent/` or a mode of `index.mjs`): subscribes (Supabase realtime) to
  `fleet_commands` for its machine where `status='pending'`, validates the verb, executes via
  `cockpit.sh`, writes status/result back. Runs on Mac (data-pull verbs) and `sentry` (run verbs).
- **B — dashboard dispatch** (`web/`): an **authed** panel — pick machine + verb (+ args), submit
  through a service-role route, watch status/result stream back. Reuses the password→cookie gate.

This is the security-sensitive surface — built last, deliberately, fully authed.
