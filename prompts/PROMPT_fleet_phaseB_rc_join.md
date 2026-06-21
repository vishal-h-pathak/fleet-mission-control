# Phase B — /rc depth join (surface a session's remote-control URL)

Read `prompts/PROMPT_fleet_conventions.md` first. Branch: `feat/fleet-phaseB-rc`. This one session
touches BOTH the reporter (`index.mjs`, repo root) and the dashboard (`web/`) — keep the changes
small and disjoint.

## Goal
Make a running Claude Code session's `/remote-control` URL appear on its job card so that, signed in
on a phone, you tap it (or scan a QR) and drop straight into steering that session. The plumbing
exists (reporter `.rc` sidecar → `fleet_job_links.rc_url` → authed dashboard route); this phase makes
capture ergonomic and adds a cross-device QR, then we test it live.

## Reporter (`index.mjs`) — capture the /rc URL with less manual work
The reporter already reads `$LOG_DIR/<name>.rc` and forwards its first line as `rc_url` (PRIVATE).
Keep that as the explicit override, and add:
- **Auto-detect from the job log:** scan the job's `$LOG_DIR/<name>.log` for a Claude Code
  remote-control URL and, if present, use it as `rc_url`. Determine the real URL shape first — run
  `/remote-control` in a Claude Code session and/or check `code.claude.com/docs/en/remote-control` —
  and build a PRECISE regex (don't over-match arbitrary URLs). The `.rc` sidecar, if present, wins
  over a log-scraped value.
- **`--set-rc <name> <url>`:** a tiny helper that writes `<url>` to `$LOG_DIR/<name>.rc` (so a
  launched session — Phase C — can self-register its URL). Validate it's an https URL; no shell use.
- Stay zero-dependency, Node 18+, ESM. `rc_url` remains PRIVATE (never in a public field).

## Dashboard (`web/`) — make it actionable from a phone
The authed `/api/job/[id]/links` route + "Open in remote control" affordance already exist (P0).
- **Confirm mobile tap-through:** at 390px the affordance is a real, tappable link that opens
  `rc_url` in a new tab. Fix if it isn't.
- **Add an authed QR:** when authed and a job has an `rc_url`, render a QR of it (so you can view the
  dashboard on a laptop and scan to open the session on your phone). A small npm QR lib in `web/` is
  fine (web is not zero-dep); keep it light. The QR + URL appear ONLY when authed — never on the
  public surface. Confirm the public page/JSON still contains no `rc_url`.

## Acceptance (validate, then STOP and report)
1. Reporter: with a `.rc` sidecar OR a real `/rc` URL in a job log, that job's `rc_url` populates in
   `fleet_job_links` (I'll confirm in the DB). `--set-rc <name> <url>` writes the sidecar and is
   picked up next heartbeat. Re-running doesn't duplicate. Zero new reporter deps.
2. Dashboard: `npm run build` green; authed job card shows a tappable "Open in remote control" + a QR,
   both gated; unauthed sees neither and the public surface leaks no `rc_url`. 390px verified.
3. Report real vs. stubbed, and the exact `/rc` URL regex you settled on + how you verified it.

Do not begin until I confirm. (Live end-to-end test — start a session, run /rc, see it surface, tap
it on a phone — happens after merge with my help.)
