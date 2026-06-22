# Fleet Mission Control — Closing the loop (Cowork ⇄ Code completion notifications)

> **Captured design + research — NOT yet built.** This is the brief a fresh chat picks up to
> implement the run-finished notification feature (the concrete, researched expansion of
> `ROADMAP.md` Phase D and `BRIEF.md` P3). Maintainer: Vishal. Date: 2026-06-22.
> Read `BRIEF.md` (architecture) + `HOW_IT_WORKS.md` + `ROADMAP.md` first.

## The problem (the workflow gap this closes)

Vishal's agentic workflow has two halves: **Cowork** is the planning/delegation surface (plan an
experiment, write the prompts, dispatch the waves); **Claude Code** sessions are the executors —
local on the Mac, and **delegated headless on `sentry`** via `cockpit.sh run` (`claude -p` in tmux).

Today the loop between them is closed **by hand**: watch a Code session until it finishes, then
copy-paste its final output back into Cowork to keep planning. Two costs: you have to babysit the
terminal, and you have to transcribe. The goal:

> When **any** Code session finishes, notify (a) the **human** (phone/desktop) and (b) **Cowork**,
> automatically — so plan → delegate → execute → **report-back** closes itself.

Hard requirement: **reusable across every project with zero per-project setup** — not a watcher or
scheduled task wired up each time. (This is exactly why the earlier "Mac watcher + per-project
scheduled task" idea was rejected as the primary mechanism.)

## What already exists in the fleet (build on this — don't duplicate)

- **The reporter already detects finished jobs.** When a previously-seen tmux session disappears it
  sends one final heartbeat with `status:"finished"` (or `"failed"` if the log tail looks like a
  crash) → Supabase `fleet_jobs`. **So job-completion is already an event in the bus.**
- **Supabase realtime is the bus**; the dashboard already subscribes to it. A completion already
  lands there today.
- `cockpit.sh run` / `run-b64` / `run-v` dispatch delegated headless `claude -p` sessions on `sentry`
  (tmux + tee), which the reporter classifies as `claude-session` jobs.
- **`/rc` depth** (Phase B): a running session can be steered from any device via its `/rc` URL,
  which the reporter already forwards (`$LOG_DIR/<name>.rc` → `fleet_job_links.rc_url`).
- **Tailscale** connects Mac ⇄ sentry with no public inbound.
- BRIEF already anticipated this: *"the reporter can tee the same heartbeat into SYNC.md-adjacent
  JSON so Cowork/Claude reads it."*

## The missing primitive (research) — Claude Code hooks

Claude Code has a **hooks** system: configured once per machine in `~/.claude/settings.json`, fires
on lifecycle events, runs any shell command. The relevant events:

- **`Stop`** — fires when a session/agent finishes responding (work done or cancelled; **not** on a
  user interrupt). Its JSON input includes **`last_assistant_message`** (the session's final text) —
  so a notification can carry *what* finished, not just *that* something did.
- **`SessionEnd`** — fires when a session terminates; for cleanup (can't block termination).
- **`Notification`** — fires when Claude is waiting for input/permission (a "needs you" alert,
  distinct from "done").

**Critically, hooks work in headless `-p` mode** — exactly how `cg run` launches sessions on sentry.
Configure a `Stop`/`SessionEnd` hook **once on each machine** (Mac + sentry) and **every** Code
session in **every** project self-reports on completion. That is the reusable, per-machine primitive
the workflow is missing — it replaces any per-project watcher or scheduled task.

## Notification channels (research)

- **ntfy over Tailscale (recommended — fits the existing infra).** Self-host ntfy on the tailnet;
  the hook `curl`s a topic; you get a phone/desktop push. Uses the Tailscale layer the fleet already
  depends on. (felipeelias, dev.to)
- **Slack / Telegram / Discord webhooks**, or plain desktop banners (`notify-send` / macOS).
- **Drop-in community plugins to evaluate vs rolling our own:** `code-notify` (macOS/Slack/Discord;
  also covers Codex/Gemini CLI) and `claude-notifications-go` (one-line install; ntfy/slack/telegram;
  6 event types incl. "Task Complete"/"Plan Ready"; click-to-focus). Either could save building from
  scratch.

## Proposed design (for the implementation chat to refine)

Two complementary completion signals + one new ingestion path to Cowork:

1. **Source event — Claude Code hooks (new, reusable).** Install a `Stop`/`SessionEnd` hook on Mac +
   sentry (committed as a setup script + a `~/.claude/settings.json` snippet, installed at the
   machine level so it applies to every project). The hook script:
   - extracts `last_assistant_message` + cwd / git branch / tmux session id,
   - **(a)** pushes a human notification (ntfy-over-Tailscale → phone/desktop), optionally carrying
     the job's `/rc` link (composes with Phase B → tap to resume/steer),
   - **(b)** writes a structured "done" record **into the existing fleet bus** — POST to `ingest`
     (reuse the machine's reporter token; consider a new `fleet_events` row or extend the final
     heartbeat) so it flows into Supabase like everything else, *or* a `$LOG_DIR/<name>.done` sidecar
     the reporter forwards.
   This makes *"a Code session finished, here's its final message"* a first-class fleet event, at the
   source, in every project.

2. **Bus event — reporter finished-detection (already built).** Keep it as the **backstop**: it
   catches non-Claude jobs (the `nav` evolution etc.) and sessions that crash/are killed without
   firing a hook (hooks don't fire on hard kills).

3. **Cowork ingestion — the last mile (close the loop to Cowork).** Honest constraint: **Cowork
   can't be pushed to; it reads.** Options, most→least robust:
   - **(a) Cowork reads the fleet Supabase directly** (recommended). A Cowork session queries
     `fleet_jobs` / `fleet_events` for recently-finished jobs + their final message **via the
     Supabase MCP** (already available to Cowork). The completion and the summary are already in the
     bus — Cowork just reads it, on demand or on one global schedule. No paste, no per-project wiring.
   - **(b) One global scheduled Cowork task** (set up once on the account, not per project) polling
     the bus / a drop-folder and surfacing finished runs.
   - **(c) Glance-and-point:** the ntfy push pings the human, who tells Cowork "X finished"; Cowork
     reads the landed record. Lowest effort; still removes the transcription.
   **Recommended spine: (a)** — Cowork talks to the same Supabase bus the dashboard already uses —
   with the **ntfy push (1a)** for the human. The dashboard's Phase-D "notifications" and this are
   one feature.

## Related: interactive delegated dispatch (`cg runi`) — the other half of "closing the loop"

The loop-closer above gets *completion* back to you. The complementary gap is *control during* a
delegated session. Today `cockpit.sh run` dispatches **headless `claude -p`** on the box — which
**cannot be observed mid-run, steered, or resumed.** Concretely (lesson, 2026-06-22): a calibration
session that's designed to "STOP and report, then we confirm the full run" can't actually be
*continued* — `-p` ends its turn, `cg attach` finds nothing to attach to, and each next step is a
fresh dispatch that re-reads all the context. Headless is the wrong tool for any STOP-and-confirm job.

**Proposed: a `cg runi` cockpit verb** that launches an **interactive** `claude` in tmux on the box
(no `-p`, still `--permission-mode bypassPermissions`, plus `--rc`), seeds the directive
(`tmux send-keys -l`, base64-safe like `run-b64`), and leaves a live, steerable session:
- `cg attach <name>` → full keyboard control over ssh (answer a prompt, say "launch the full run").
- `--rc` → steer from browser/phone, in sync (the Phase-B `/rc` depth layer).
- bypassPermissions + a STOP-gated prompt → autonomous work that **pauses at the STOP point** and is
  continued **in the same session, with context** — no fresh dispatch.
Reserve `-p`/`run` for truly autonomous, no-confirmation jobs. Open design points: directive-seeding
(send-keys vs paste-on-attach), `/rc` URL capture into the reporter sidecar (composes with Phase B),
and box-session git reliability — **commit before the STOP** (prompt-ordering bug seen 2026-06-22) and
verified push creds, so artifacts sync back without manual `cg artifact` ferrying. The parked
`run-v`/`peekv` streaming dispatch (`cockpit.sh` + `ops/render-stream.py`, uncommitted) is the
lighter-weight observe-only sibling — validate against the live box and commit it alongside.

## How it maps onto the roadmap

This is the researched expansion of **`ROADMAP.md` Phase D — "Notifications when a run finishes"**
and the **`BRIEF.md` P3** notification stub, plus the BRIEF "reporter tees heartbeat into JSON so
Cowork reads it" idea. It **composes with Phase B (`/rc`)**: the done-notification carries the `/rc`
link so a push becomes "tap to resume." Sequencing note: Phase A (always-on services) is a sensible
prerequisite — the reporter/bus must be running continuously for the bus-side signal to be reliable.

## Open decisions for the implementation chat

- **Channel:** ntfy-over-Tailscale (recommended) vs Slack vs desktop-only — or desktop + ntfy to start?
- **Build vs adopt:** roll our own hook script vs adopt `claude-notifications-go` / `code-notify`?
- **Cowork ingestion:** Supabase-read (a) vs one global scheduled task (b) vs glance-and-point (c)?
- **Event store:** reuse `ingest` / add a `fleet_events` table vs a `.done` sidecar the reporter
  forwards? (Schema impact — see `SCHEMA.md`; keep the public/private split.)
- **Hook event choice:** `Stop` (fires every turn in *interactive* mode; once in headless) vs
  `SessionEnd` (cleaner "session over"). For delegated headless `cg run` jobs they effectively
  coincide; for interactive Mac sessions prefer `SessionEnd` to avoid per-turn noise, and use
  `Notification` for "needs you" alerts.
- **Reliability:** hooks don't fire on hard crashes/kills — keep the reporter's tmux-disappear
  detection as the backstop, and reconcile the two signals (don't double-notify).

## Definition of done (when we build it)

- A `Stop`/`SessionEnd` hook installed on Mac + sentry (committed setup script + settings snippet),
  firing on **every** Code session including headless `cg run` jobs, in every project, zero per-project setup.
- A finished session emits **both**: a human push (ntfy/desktop) **and** a structured record in the
  fleet bus carrying its final message (+ `/rc` link if present).
- Cowork can learn a delegated session finished and read its result **with no manual paste** (Supabase
  MCP read, or one global scheduled task).
- Documented in `HOW_IT_WORKS.md`; this doc flipped to "built"; `ROADMAP.md` Phase D checked off.

## Sources (from research, 2026-06-22)

- Claude Code hooks guide — https://code.claude.com/docs/en/hooks-guide
- ntfy + Tailscale notification setup — https://dev.to/felipeelias/perfect-claude-code-notifications-setup-with-tailscale-and-ntfy-1ii1
- Notification hooks walkthrough — https://alexop.dev/posts/claude-code-notification-hooks/
- code-notify (cross-platform, multi-CLI) — https://github.com/mylee04/code-notify
- claude-notifications-go (webhooks: ntfy/slack/telegram) — https://github.com/777genius/claude-notifications-go
- macOS notification hooks — https://nakamasato.medium.com/claude-code-hooks-automating-macos-notifications-for-task-completion-42d200e751cc
