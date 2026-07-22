# Fleet Mission Control — roadmap (post P0–P2)

> P0 (monitoring), P1 (logs/metrics), P2 (authed control plane) are built, merged, and live.
> This is the sequenced plan for everything after. Built chronologically; each phase is a wave
> of Claude Code sessions (setup-*-wave.sh) + per-machine ops, consolidated via the consolidate
> prompt. Date: 2026-06-21.

## Where we are
- **P0** machine cards (online/load/GPU), realtime. **Live.**
- **P1** per-job fitness sparkline (public) + authed log view. **Live;** sentry's `nav` run imported (70 gens).
- **P2** authed command queue: dashboard → `fleet_commands` → token-authed agent → `cockpit.sh` →
  result. Verbs: `check/status/fetch-log/pull/artifact` (read-only/safe). Allowlist drift-guarded
  by `scripts/check-allowlist-parity.mjs`. Round-trip proven (`check` → sentry → result).
- Gap: nothing runs continuously yet (Mac reporter offline; sentry reporter in tmux; agent only `--once`).

## Phase A — Operationalize (NEXT)
Make it run 24/7 and prove the control plane live from the browser. No new features.
- **Services:** reporter as launchd on Mac + systemd on sentry; agent as launchd on Mac (+ systemd on
  sentry if/when it should run sentry-local verbs). Both read the repo-root `.env` (Mac uses the
  mac-cockpit token; sentry the sentry token). Survive reboot.
- **Live authed dispatch E2E:** log into the deployed dashboard, dispatch `check` to `mac-cockpit`,
  watch it go `pending→done` with the real result in the UI (the one P2-B path not yet live-exercised).
- **Docs refresh:** BRIEF status + README to reflect P0–P2 shipped.
- **Done when:** both machines show continuously online; a browser-dispatched command round-trips.

## Phase B — /rc depth join
Surface a running Claude Code session's `/remote-control` URL so tapping a job on the phone drops
into Anthropic's native steering. Plumbing largely exists (reporter `.rc` sidecar →
`fleet_job_links.rc_url` → dashboard authed "Open in remote control").
- Add a tiny helper so a launched/started `claude` session writes its `/rc` URL to
  `$LOG_DIR/<name>.rc`; verify the reporter forwards it and the dashboard surfaces it (authed).
- Verify tap-through on a phone end to end.
- **Done when:** a live session's `/rc` link appears on its job card (authed) and opens the session.

## Phase C — Launch verb (control plane's launch capability)
The original goal: kick off heavy work on a machine from the dashboard/phone. Security-sensitive —
the first verb that *starts* something rather than reading/pulling.
- Add a reviewed verb (e.g. `start-nav` / `run`) to BOTH allowlists (parity test must stay green),
  mapping to `cockpit.sh nav` / `run <repo> "<directive>"` with strict arg validation (repo from a
  fixed set; directive length-capped; still argv-array, never a shell string).
- Dashboard dispatch UI gains the verb (authed). Launched Claude sessions emit their `/rc` URL
  (composes with Phase B → launch from phone, then steer).
- Keep a hard cap: no arbitrary shell, ever; the directive is data passed to `cockpit.sh run`, which
  already runs it under `claude` in a tmux session on the box.
- **Done when:** an authed dispatch starts a run on sentry and its job (+ `/rc` link) appears live.

## Phase D — Polish
- **Close the loop: run-finished notifications (Cowork ⇄ Code).** ✅ **BUILT 2026-06-23** — see
  **`docs/LOOP_CLOSER.md`** for the full brief. The reusable primitive is
  **Claude Code hooks** (`Stop`/`SessionEnd`, configured once per machine, work in headless `cg run`
  jobs): on completion, push to the human (ntfy-over-Tailscale fits the existing infra) **and** write
  a structured record into the fleet bus carrying the session's final message (+ `/rc` link). Cowork
  closes its half by **reading the fleet Supabase** (Supabase MCP) — no per-project setup, no manual
  paste. Builds on the reporter's existing finished-job detection (kept as the crash backstop).
  (Was the one-line "run-done → push/Slack/email" stub; now built.)
  **Status:** hook (F2-a, `deploy/hooks/`) + bus path (F2-b — private `last_message` column +
  idempotent `ingest` v4, live) + Cowork read (F2-c, `docs/COWORK_INGEST.md`) all built and merged.
  **To flip fully live:** install the hook on Mac + sentry from `main` + rotate the ntfy topic.
- **Interactive delegated dispatch — `cg runi`.** ✅ **BUILT 2026-06-23.** A cockpit verb to launch
  *interactive* (not `-p`) `claude` sessions on the box in tmux with `--rc`, so delegated sessions can
  be **observed, steered, and resumed in-context** — `cg attach` over ssh for keyboard control, `/rc`
  for browser/phone — and **pause at a prompt's STOP point for an in-session go/no-go** instead of a
  fresh dispatch that re-reads everything. Lesson that motivated it (2026-06-22): headless `claude -p`
  can't be attached or resumed and is the wrong tool for STOP-and-confirm jobs; reserve `-p` for truly
  autonomous, no-confirmation work. Pairs with Phase B (`/rc`) and the loop-closer above. Also folds in
  the parked `run-v`/`peekv` streaming dispatch and box-session git reliability (commit-before-stop +
  push-creds). Design detail in `docs/LOOP_CLOSER.md`.
  **Status:** `cg runi` shipped in portfolio `cockpit.sh`, live-validated on sentry — interactive
  `--rc` **does** surface a `/rc` URL (headless `-p` never did). `run-v`/`peekv` (F3) + git
  reliability (F4) also built. **Remaining:** merge the portfolio cockpit branch.
- Command history view in the dashboard (authed).
- GPU/temp telemetry surfaced on cards (data already collected by the reporter).
- Multi-project grouping; history/retention tuning.

## Deferred infra (revisit anytime)
- Dedicated Supabase project (org is at the 2-free-project cap today).
- Clean `fleet.vishal.pa.thak.io` domain (currently the button points at the `vercel.app` URL).
