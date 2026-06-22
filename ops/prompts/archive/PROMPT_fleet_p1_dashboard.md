# P1-B — Dashboard: fitness sparkline + authed log view

Read `prompts/PROMPT_fleet_conventions.md` first. Branch: `feat/fleet-p1-dashboard`.
Folder: `web/` (the existing Next.js dashboard).

## Goal
Add two things to each job card: a **public fitness sparkline** (from the new metrics time-series)
and an **authed log view** (recent log lines, gated like the `/rc` links).

## Data
- **Public:** `public.fleet_job_metrics` — `job_id, ts, gen, best_fitness, mean_fitness`.
  Realtime-enabled. Read with the anon key. Plot `best_fitness` (and `mean_fitness` if present) vs.
  `gen` as a small sparkline/line on the job card; show latest best fitness as a number.
- **Private (authed only):** `fleet_job_links.log_tail` — recent log lines. Add a **server-only**
  route `GET /api/job/[id]/log` that uses the service role to return `log_tail` for a job, gated by
  the SAME auth cookie/middleware that protects `/api/job/[id]/links`. The public surface must NEVER
  include `log_tail`.

## What to build
- **Sparkline:** per job, fetch its `fleet_job_metrics` (ordered by `gen`), render a compact line
  (Recharts is already a portfolio dep; or a tiny inline SVG to stay light — your call, keep it
  fast). Subscribe to realtime inserts on `fleet_job_metrics` so a running job's curve grows live.
  Phone-responsive; the sparkline must look fine at 390px.
- **Log view:** a "Logs" affordance on each job card. When unauthed, show the sign-in prompt (reuse
  the `/rc` pattern). When authed, call `/api/job/[id]/log` and show the lines in a scrollable,
  monospace, wrapped block. Don't poll aggressively — fetch on open + a manual refresh button.
- Reuse existing auth (password→signed cookie + middleware). No new auth system.

## Acceptance (validate, then STOP and report)
1. `npm run build` green.
2. A job with metrics shows a sparkline that updates live when new `fleet_job_metrics` rows arrive
   (test by inserting a row or running the P1 reporter). Latest best-fitness number shown.
3. `GET /api/job/<id>/log` returns 401 without the cookie and the log lines with it; the public
   page/JSON never contains `log_tail`. Confirm explicitly.
4. Mobile layout verified at 390px. Report real vs. stubbed.

Do not begin until I confirm.
