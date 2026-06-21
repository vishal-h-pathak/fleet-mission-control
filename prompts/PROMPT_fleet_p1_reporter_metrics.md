# P1-A — Reporter: emit per-generation metric points

Read `prompts/PROMPT_fleet_conventions.md` first. Branch: `feat/fleet-p1-reporter-metrics`.
File: `index.mjs` (the reporter lives at the repo ROOT, not in a subfolder).

## Goal
Extend the existing reporter so each job in the heartbeat can carry a `metrics` array of
per-generation fitness points, which `ingest` stores in `fleet_job_metrics` (public) for the
dashboard's fitness sparkline. Also add a one-shot backfill for a finished run's log.

## The contract (already live; build to it exactly)
`ingest` (v3) accepts, per job:
```
"metrics": [ { "gen": 42, "best_fitness": 0.81, "mean_fitness": 0.55, "ts"?: "ISO", "extra"?: {} } ]
```
Stored idempotently on `(job_id, gen)` in `public.fleet_job_metrics`. Sending the same gen twice
is safe (upsert). Don't change the DB or `ingest` — if you think the contract needs changing,
STOP and report.

## What to build
- **Parse metric points from the job log.** Reuse the existing progress regexes (the reporter
  already extracts `gens_done`/`best_fitness`); generalize to capture a point per generation line:
  `{ gen, best_fitness, mean_fitness? }`. Add `mean_fitness` patterns (`mean[_ ]?fit\w*[:= ]+([\d.]+)`).
- **Only send new generations.** Track the highest `gen` already sent per job (in-memory is fine;
  optionally persist a tiny `$LOG_DIR/<name>.cursor` so restarts don't resend). Each heartbeat
  includes only generations parsed since the last send. Cap the array (e.g. ≤200 points/heartbeat)
  to keep payloads sane; the rest flush on subsequent heartbeats.
- **`--import-log <name>` flag (backfill).** Parse the ENTIRE `$LOG_DIR/<name>.log`, emit every
  generation's metric point in one (or a few chunked) heartbeat(s) for that job, then exit. This is
  how a finished run that pre-dates the reporter gets its full curve into the dashboard. The job row
  it attaches to: upsert the job by `(machine, name)` as today; if the run is finished, send
  `status:"finished"` so the curve attaches to a closed job.
- Keep everything else (host metrics, GPU, `log_tail`, `.rc` passthrough, finished-job detection)
  unchanged. Stay zero-dependency, Node 18+, ESM.

## Acceptance (validate, then STOP and report)
1. `node index.mjs --dry-run` shows a `metrics` array on a job when the log has gen/fitness lines.
2. `node index.mjs --once` against live `ingest` returns `{ok:true}` and rows land in
   `fleet_job_metrics` (I'll confirm in the DB). Re-running does NOT duplicate rows (idempotent).
3. `node index.mjs --import-log <name>` backfills a finished run's full curve to `fleet_job_metrics`.
4. No new npm deps. Update `README.md`'s "What it collects" + add an `--import-log` note. Report
   what's real vs. stubbed (e.g. mean_fitness regex coverage).

Do not begin until I confirm.
