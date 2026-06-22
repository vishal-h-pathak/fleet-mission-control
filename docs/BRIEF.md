# Fleet Mission Control — project brief (working title)

> **Captured idea, not yet built.** A new project: one web interface on vishal.pa.thak.io that is
> Vishal's single pane of glass over all his machines (Mac cockpit, `sentry` = 5900X/3080Ti
> workstation, phone, future nodes) — monitor what's running, see logs/metrics, and dispatch work,
> from any device including mobile. Builds directly on the cross-machine system
> (`docs/cellular-gaits/CROSS_MACHINE.md`, `cockpit.sh`, Tailscale, `SYNC.md`).
> Maintainer: Vishal. Status: **P0–P2 shipped & live** — monitoring, logs/metrics, and an authed
> cross-machine control plane are built, merged, and deployed. The `dashboard → command queue →
> token-authed agent → cockpit.sh → result` round-trip is proven (`check` reached sentry). Next:
> operationalize (always-on services), then /rc depth join, then a launch verb, then polish —
> see `docs/ROADMAP.md`.

## Why
- A true remote interface to the fleet: kick off / watch heavy runs from the phone, not just the Mac.
- Strong portfolio piece: agentic-infrastructure / systems work, adjacent to the neuromorphic line.
- Generalizes beyond cellular-gaits — any project's runs on any machine show up here.

## The core constraint (shapes the architecture)
Machines live behind Tailscale with **no public inbound**. A public, phone-reachable dashboard
must therefore work **without** opening ports on the machines. → use a **push / message-bus**
model, not direct connections from the web app to the machines.

## Recommended architecture — Supabase as the bus (portfolio already uses Supabase)
- **Reporter (per machine):** a small daemon writes a heartbeat every N s → Supabase: machine
  online, CPU/GPU load, RAM, running jobs (name, gens done, latest fitness, ETA), last log lines.
- **Dashboard (new page on the site):** Next.js, reads Supabase **realtime**, responsive for phone.
  Pure read = the monitoring plane. No inbound to machines (they push out).
- **Control plane (command queue):** dashboard writes a `command` row (allowlisted verbs:
  `run-prompt`, `start-nav`, `stop`, `fetch-log`, …); each machine's agent subscribes (Supabase
  realtime), executes via the existing `cockpit.sh` primitives, writes status/result back. Machines
  **pull** commands — still no open ports.
- **Tailscale stays** as the heavy-transport layer (live SSH, big artifacts, log streaming);
  the dashboard is observe + command, not bulk data.
- **Auth:** the control plane MUST be authed (dispatching jobs from a public URL is sensitive);
  reuse the portfolio's existing auth. Monitoring can be gated too. Commands allowlisted; the
  machine agent only executes known verbs with validated args (never arbitrary shell from the web).

## Two-layer model — built ON TOP OF Claude Code Remote Control (key insight, 2026-06-21)
Anthropic's **`/remote-control`** (`/rc`, Feb-2026 research preview, Max-only for now) already
solves the *deep* half: it bridges a **running** local Claude Code session to claude.ai/code +
the iOS/Android apps via a URL/QR, keeps the process + full local env (fs, MCP, tools) local
(nothing goes to cloud), and **syncs the conversation across terminal/browser/phone**. Limits:
**can't *start* a session from mobile (only continue), Max-only, some interactive slash cmds are
local-only.** Docs: code.claude.com/docs/en/remote-control.

→ **Do NOT rebuild live agent-steering.** The fleet system is two layers:
- **Depth = `/rc` (Anthropic's):** steer/watch any running session from any device, in sync. Free, authed, no infra.
- **Breadth = the fleet layer (what we build):** cross-machine awareness + launch + notifications.
  Machines push heartbeats/job-status to the bus; the dashboard shows every machine/job; launching
  work runs via `cockpit.sh`. **The join:** the dashboard stores & surfaces each session's `/rc`
  URL/QR — tap a job on your phone → drop straight into Anthropic's native remote control. Breadth
  indexes, `/rc` cockpits.

Architecture options weighed: **A Lean** (mostly `/rc` + thin notifier — minimal infra, no fleet
view), **B Hybrid** (fleet bus + dashboard + `/rc` depth — full closed loop, scalable, the
portfolio project), **C off-the-shelf** (CloudCLI/claudecodeui — fast but not ours, no fleet view).
**Chosen: B**, explicitly on top of `/rc`.

## How it builds on what exists
- `cockpit.sh` = the executor the machine-agent shells out to (run/nav/logs/fetch/artifact/wait).
- `SYNC.md` = the human/agent narrative state board (stays); the dashboard is the live telemetry.
- W&B (Layer 3, `PROMPT_wandb_integration.md`) = optional rich fitness charts; embed or link.
- The reporter can also tee the same heartbeat into `SYNC.md`-adjacent JSON so Cowork/Claude reads it.

## Phasing
- **P0 — monitoring (read-only): ✅ SHIPPED 2026-06-21.** Schema + `ingest` live; Node reporter
  validated against live ingest; Next.js dashboard deployed (realtime machine cards online/load +
  active jobs + latest fitness, phone-responsive) with an authed slice for `/rc` links; reachable
  via a `FLEET ↗` button on `vishal.pa.thak.io`. *Remaining:* install the reporter as a persistent
  service on Mac + `sentry` (so far it has only run as `--once` tests), and (optional) the clean
  `fleet.vishal.pa.thak.io` domain. No control plane yet (by design).
- **P1 — logs & metrics:** stream recent log lines + a fitness sparkline per job into the dashboard.
- **P2 — control:** authed command queue; phone can `start-nav` / `run-prompt <x>` / `stop`.
- **P3 — polish:** notifications (run done), multi-project view, history, GPU/temp telemetry.

## Open questions
**Resolved 2026-06-21:**
- ~~Name~~ → **Fleet Mission Control**.
- ~~Max plan dependency for `/rc`~~ → **on Max**, so the `/rc` depth layer is available.
- ~~Public vs authed~~ → **public shell + authed controls** (enforced in the DB via the
  public/private table split; authed slice gates the `/rc` links).
- ~~Reporter Python vs Node~~ → **standalone Node agent** (own service per machine, zero npm deps,
  decoupled from the cellular Python env).
- ~~First milestone~~ → **P0 monitoring shipped.**

**Still open:**
- Does this supersede or complement W&B for metric charts? (Revisit in P1.)
- Clean domain `fleet.vishal.pa.thak.io` (needs a DNS CNAME) — currently the button points at the
  `fleet-mission-control.vercel.app` URL via `NEXT_PUBLIC_FLEET_URL` in the portfolio project.
- Reporter `--once` test only so far; needs to run as a launchd/systemd service to keep cards live.
- Dedicated Supabase project if/when the org moves off the 2-free-project cap (P0 shares the
  portfolio project today).

## Changelog
- **2026-06-22 (loop-closer designed + repo reorg)** — Scoped the **run-finished notification**
  feature (Cowork ⇄ Code loop) into a full design brief: `docs/LOOP_CLOSER.md`. Research found the
  reusable primitive is **Claude Code hooks** (`Stop`/`SessionEnd`, once per machine, fire in headless
  `cg run` jobs); proposed design pushes to the human (ntfy-over-Tailscale) **and** writes a
  structured completion record into the existing fleet bus (carrying `last_assistant_message` + the
  `/rc` link), with **Cowork reading the fleet Supabase via MCP** as the no-paste ingestion path —
  building on the reporter's existing finished-job detection (kept as the crash backstop). Elevated in
  `ROADMAP.md` Phase D from a one-line stub; **implementation deferred to a dedicated chat.** Also
  reorganized the repo to the shared `ops/` convention (matching `cellular-gaits` + `portfolio`):
  prompts → `ops/prompts/` (+ `archive/`), wave launchers → `ops/waves/` (+ `archive/`); root now
  holds only the running system + `README`/`ONBOARDING`. Active wave scripts (`phaseB`, `phaseC`)
  repathed to `ops/prompts/`; `ops/README.md` + `HOW_IT_WORKS` updated.
- **2026-06-21** — Brief created after the two-machine cockpit went live (`cg check` reached
  `sentry`). Captured the push-via-Supabase architecture + phasing. Not started.
- **2026-06-21 (research)** — Researched Anthropic's `/remote-control` (`/rc`). Reframed to a
  **two-layer model**: `/rc` = depth (live agent steering, any device, free/Max, no infra — do NOT
  rebuild), fleet bus/dashboard = breadth (awareness + launch + notify), joined by the dashboard
  surfacing each session's `/rc` URL. Architecture B (Hybrid on top of `/rc`) chosen. Flagged Max
  plan dependency for `/rc`. Sources: code.claude.com/docs/en/remote-control,
  simonwillison.net/2026/Feb/25/claude-code-remote-control/.
- **2026-06-21 (P0 build)** — Open questions resolved: name = **Fleet Mission Control**; on
  **Max** (so `/rc` is available); access = **public shell + authed controls**; reporter =
  **standalone Node agent** (own service per machine, decoupled from the cellular Python env).
  Supabase: org is at the **2-free-project cap**, so P0 lives in the **shared** portfolio project
  (`sbmsxerwgylpfkkkjtku`) with `fleet_`-prefixed tables rather than a dedicated project
  (revisit if upgrading to Pro). **Applied P0 schema** (`fleet_machines`, `fleet_machine_secrets`,
  `fleet_heartbeats`, `fleet_jobs`, `fleet_job_links`, `fleet_machine_status` view) with the
  public/private security split enforced via RLS, plus realtime publication, 48h heartbeat
  retention (pg_cron), and a `fleet_register_machine` token helper. **Deployed the `ingest` Edge
  Function** (per-machine bearer-token auth, service-role writes; no anon writes anywhere).
  Schema documented in `docs/SCHEMA.md`. Security advisors: clean (the only fleet notices are the
  intended deny-all on the two private tables). Next: Node reporter + Next.js realtime dashboard.
- **2026-06-21 (P0 shipped)** — Built P0 via 3 parallel Claude Code sessions (worktree+branch each,
  staged by `setup-fleet-p0-wave1.sh`), then consolidated. **Reporter** (`index.mjs`, zero-dep
  Node): host metrics + GPU (`nvidia-smi`) + tmux/cockpit-log job scraping → `ingest`; validated
  with a real heartbeat landing in `fleet_heartbeats`; launchd + systemd units written. **Dashboard**
  (`web/`, Next.js 16 / React 19 / Tailwind 4): realtime machine cards + active jobs, phone-responsive
  (verified at 390px); authed `/api/job/[id]/links` route (password→signed HttpOnly cookie) that
  surfaces `/rc` URLs only to an authed viewer — verified end-to-end (401 without cookie, `rc_url`
  with it, public surface leaks nothing). **Deployed** the dashboard to its own Vercel project
  (`fleet-mission-control`, root dir `web/`) → `fleet-mission-control.vercel.app`. **Portfolio link**:
  added a `FLEET ↗` nav button + `/fleet` 302 redirect (env `NEXT_PUBLIC_FLEET_URL`); merged to
  portfolio `main` and live on `vishal.pa.thak.io`. Both machines registered
  (`mac-cockpit`, `sentry`). Repos: `github.com/vishal-h-pathak/fleet-mission-control`. Remaining P0
  polish: reporter-as-service on each machine; optional `fleet.vishal.pa.thak.io` domain.
- **2026-06-21 (P1 shipped)** — Logs & metrics. Added `fleet_job_metrics` (public per-gen fitness
  series) + `ingest` v3 accepts metric points. Reporter parses per-generation `best=`/`mean=`
  (CMA-ES dialect, widened after gauging sentry's `nav` log) and gained `--import-log` backfill;
  sentry's 70-gen `nav` run imported as the first live sparkline. Dashboard adds a public fitness
  sparkline + an authed log view. Deployed.
- **2026-06-21 (P2 shipped)** — Authed control plane. `fleet_commands` queue (deny-all RLS) + a
  token-authed `commands` Edge Function (agents claim/report with their machine token, NO
  service-role key on the machine). Per-machine control agent (`agent/`) maps an allowlist
  (`check/status/fetch-log/pull/artifact`) → `cockpit.sh` via `spawnSync` `shell:false` + strict
  charset validation; dashboard gains an authed dispatch panel. Round-trip proven: queued `check`
  → Mac agent → `cockpit.sh check` → SSH to sentry → `reachable` result written back. Allowlist
  drift-guarded by `scripts/check-allowlist-parity.mjs` (caught + fixed a real agent↔dashboard
  divergence). Forward plan: `docs/ROADMAP.md` (operationalize → /rc join → launch verb → polish).
