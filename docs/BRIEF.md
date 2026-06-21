# Fleet Mission Control — project brief (working title)

> **Captured idea, not yet built.** A new project: one web interface on vishal.pa.thak.io that is
> Vishal's single pane of glass over all his machines (Mac cockpit, `sentry` = 5900X/3080Ti
> workstation, phone, future nodes) — monitor what's running, see logs/metrics, and dispatch work,
> from any device including mobile. Builds directly on the cross-machine system
> (`docs/cellular-gaits/CROSS_MACHINE.md`, `cockpit.sh`, Tailscale, `SYNC.md`).
> Maintainer: Vishal. Status: **P0 in progress** — Supabase schema + ingest deployed.

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
- **P0 — monitoring (read-only):** reporter on Mac + sentry → Supabase; dashboard shows machine
  cards (online/load) + active jobs + latest fitness. Phone-responsive. No control yet.
- **P1 — logs & metrics:** stream recent log lines + a fitness sparkline per job into the dashboard.
- **P2 — control:** authed command queue; phone can `start-nav` / `run-prompt <x>` / `stop`.
- **P3 — polish:** notifications (run done), multi-project view, history, GPU/temp telemetry.

## Open questions
- Name (Fleet / Mission Control / Cockpit-web / …). New folder exists: `fleet-mission-control`.
- **Plan dependency:** is Vishal on **Max**? `/rc` is Max-only right now. If not, the depth layer
  needs an alternative (open-source webui, or our own ws bridge over Tailscale) until Pro ships.
- Public project page vs authed-only app on the site (or public shell, authed controls).
- Reporter as a Python service (uv) or a tiny Node/systemd unit per machine? (Python reuses the
  cellular env; a standalone agent is more general.)
- Does this supersede or complement W&B for metric charts?
- First milestone: **P0 monitoring-only recommended** (safe, read-only, proves the bus, ships
  fast); control plane (P2) lands later behind real auth.

## Changelog
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
