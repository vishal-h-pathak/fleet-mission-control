# Fleet Mission Control — onboarding (read this first)

> For a fresh Cowork chat picking up this project. Read this, then `docs/BRIEF.md`. You'll be
> caught up. Maintainer: Vishal. Working with the Mac as cockpit + a Windows workstation
> (`sentry`, 5900X/3080Ti) + phone, already wired together (see "What already exists").

## What this project is
A new project: **one web interface on vishal.pa.thak.io that is Vishal's single pane of glass
over all his machines** (Mac, `sentry`, phone, future nodes) — see what's running everywhere,
view logs/metrics, dispatch and steer work, from any device including mobile. A long-term,
iterated tool; **scalability + security are first-class.** It's also a deliberate portfolio piece
(agentic-infrastructure systems work).

## The design is already decided — `docs/BRIEF.md` is the source of truth
Key conclusions (don't relitigate unless asked; refine as you build):
- **Two-layer model built ON TOP OF Claude Code's `/remote-control` (`/rc`).**
  - *Depth (don't rebuild):* `/rc` already bridges a **running** Claude Code session to web + the
    iOS/Android apps (URL/QR, full local env stays local, conversation syncs across devices).
    Limits: can't *start* from mobile, Max-only (preview), some interactive slash cmds local-only.
  - *Breadth (what we build):* a **push/message-bus** fleet layer — machines push heartbeats/job
    status to **Supabase** (realtime), a phone-responsive **dashboard** (Next.js page on the site)
    shows every machine + job; launching work runs via the existing `cockpit.sh` primitives.
  - *The join:* the dashboard stores & surfaces each session's `/rc` URL/QR → tap a job on your
    phone → drop into Anthropic's native remote control. Breadth indexes, `/rc` cockpits.
- **Architecture B (Hybrid)** chosen over Lean / off-the-shelf.
- **Build P0 monitoring-first** (read-only, safe, proves the bus), then logs/metrics, then the
  authed control plane (the security-sensitive surface) **last and deliberately**.
- **Security zones:** heartbeats = write-only per-machine token + Supabase RLS; control plane =
  real auth + strict verb allowlist (agent runs only known commands, never arbitrary shell from
  the web); Tailscale for bulk/direct transport.

## What already exists to build on (in the sibling `portfolio` repo)
The two-machine system is LIVE — this project sits on top of it. If the `portfolio` repo is
mounted, read these; otherwise ask Vishal to mount it:
- `portfolio/docs/cellular-gaits/CROSS_MACHINE.md` — the cross-machine playbook (roles, git spine, daily loop).
- `portfolio/cockpit.sh` — the Mac→`sentry` control script (check/run/nav/logs/peek/fetch/artifact/wait/morning).
  This is the **executor** the fleet control plane will call. Study its command surface.
- `portfolio/docs/cellular-gaits/SYNC.md` — the cross-machine live state board (narrative state).
- Supabase is already used by the portfolio (there's prior telemetry/auth code to reuse).
- Tailscale is up: `sentry` = `100.86.154.46`, Mac online; the phone is on the tailnet too.

## Open questions to resolve at the START of the build (ask Vishal)
1. **Name** (Fleet / Mission Control / Cockpit-web / …) — folder is `fleet-mission-control`.
2. **Max plan?** `/rc` is Max-only right now. If not on Max, the depth layer needs a stand-in
   (open-source webui or a small Tailscale ws bridge) until Pro access ships.
3. **Public project page vs authed-only app** (or public shell + authed controls).
4. **Reporter as Python (uv) or a standalone Node/systemd agent** per machine.

## How we work (disposition)
- **Radical honesty / no overclaiming.** Say plainly what's a stub vs real, what's secure vs not.
- **Living docs:** keep `docs/BRIEF.md` current; append-only changelogs; date-stamp decisions.
- **Be an opinionated partner**, not an order-taker — recommend, push back, surface tradeoffs.
- **Validate before shipping**, especially anything touching the control plane / security.
- Use Cowork's task list + AskUserQuestion for scoping; design-in-chat → delegate builds.

## First moves
1. Confirm the 4 open questions with Vishal (esp. name + Max plan).
2. Initialize this folder as the project (Next.js app or a docs+infra scaffold — decide with him).
3. Design the **Supabase schema** for P0 (machines, heartbeats, jobs) + the **reporter** that
   `sentry`/Mac run to push status. Build P0 monitoring (read-only dashboard) end to end first.
