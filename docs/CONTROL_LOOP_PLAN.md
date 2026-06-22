# Fleet Mission Control — Control-Loop Implementation Plan (Phase D)

> **PLAN, not built.** Sequences the four "close the loop" features (Cowork ⇄ Claude Code) into
> CC-session-sized prompts + a wave, flags the open decisions, and names the dependencies. The
> researched design lives in `docs/LOOP_CLOSER.md`; this doc turns it into a build order.
> Maintainer: Vishal. Date: 2026-06-22. **Bring back for review before any `PROMPT_*.md` is written.**
>
> **Scope guard:** fleet / control-plane tooling only. Cellular-gaits science work is out of scope.
>
> **Repo-mount caveat:** only `fleet-mission-control` is mounted in this planning session;
> `portfolio` (which holds `cockpit.sh` + `ops/render-stream.py`) is **not**. The cockpit-touching
> features (F1, F3, F4) are planned from `LOOP_CLOSER.md` + the Phase C `run-b64` precedent, not the
> live `cockpit.sh` source. Each cockpit session must run **on the Mac** (where `portfolio` + the
> Tailscale path to `sentry` exist), exactly as the Phase C wave did.

## The four features (recap)

| # | Feature | Surface | Status today |
|---|---|---|---|
| **F1** | `cg runi` — interactive delegated dispatch | `cockpit.sh` (portfolio) | not started |
| **F2** | Run-finished notifications (the loop-closer) | machines (hooks) + fleet bus + Cowork-read | researched (`LOOP_CLOSER.md`) |
| **F3** | `run-v`/`peekv` streaming dispatch | `cockpit.sh` + `ops/render-stream.py` (portfolio) | **drafted, uncommitted, untested** |
| **F4** | Box-session git reliability | prompt template + box creds | active bug (2026-06-22) |

## What already exists (build on, don't duplicate)

- **`/rc` depth (Phase B):** a running session's `/remote-control` URL is scraped from its log /
  `.rc` sidecar → `fleet_job_links.rc_url` → surfaced authed on the dashboard. Both F1 and F2 reuse
  this; do **not** rebuild steering.
- **The reporter's finished-job detection:** tmux session disappears → one final heartbeat
  `status:"finished"` (or `"failed"` on a crashy tail) → `fleet_jobs`. This is F2's **backstop**.
- **The bus + ingest:** `ingest` Edge Function, per-machine bearer-token auth, service-role writes,
  public/private table split (`fleet_jobs` public, `fleet_job_links` private). Schema is **frozen**
  for P0 — any change is planner-owned (conventions §"data layer is LIVE and FROZEN").
- **`run-b64`:** the zero-quoting-surface precedent — directive base64-encoded across ssh/tmux,
  decoded on the box, never `eval`. F1's seeding mirrors this.
- **The ops convention:** one self-contained `PROMPT_fleet_*.md` per session (reads
  `PROMPT_fleet_conventions.md` first), branch per session, validate → **STOP & report** → commit on
  branch (don't merge), consolidate via the consolidate prompt with the parity check.

## Dependencies & shared primitives

```
            ┌─────────────────────── /rc (Phase B, exists) ───────────────────────┐
            │                                                                       │
   F4 git reliability  ──prereq──►  F1 cg runi  ◄──sibling/seeding──►  F3 run-v/peekv
   (commit-before-STOP,                  │                                  │
    push creds)                          │ (interactive pauses                │ (observe-only;
            │                            │  → "needs you")                    │  proves stream-json +
            └──prereq (artifacts sync)───┴──────┐                            │  tmux seeding F1 reuses)
                                                 │                            │
   F2 notifications ──── hook (Stop/SessionEnd/Notification, once per machine) ───┐
       ├ push to human (ntfy-over-Tailscale + desktop), carries /rc link          │
       ├ write completion record into the bus (last_assistant_message + rc_url)   │
       └ Cowork reads the bus via Supabase MCP (no push to Cowork; it reads)      │
                          backstop: reporter finished-detection (exists) ─────────┘
```

Key relationships:
- **F4 is a prerequisite for the *value* of F1/F3.** A delegated session that STOPs with uncommitted
  work strands artifacts (the 2026-06-22 bug). Fix this first or the rest delivers half its value.
- **F3 is the observe-only sibling of F1** and is already drafted — validating it proves the
  `stream-json` + tmux seeding plumbing that F1's interactive seeding reuses. Do F3 before F1.
- **F2 is mechanically independent** of the cockpit verbs (different files/surfaces), so it runs as a
  **parallel track**. It *composes* with the others: the push carries the `/rc` link (tap-to-resume);
  the `Notification` hook becomes the "needs you" ping for an F1 session paused at a STOP gate; the
  `Stop`/`SessionEnd` hook fires for `run`, `runi`, and `run-v` sessions alike.
- **F2's Cowork last-mile is a read, never a push** — Cowork queries the same Supabase bus the
  dashboard uses, via the Supabase MCP. No per-project wiring.

## Recommended build sequence

1. **F4 — git reliability (fast prereq).** Small, unblocks every delegated dispatch, kills the active
   bug. Largely a prompt-template ordering fix + a box push-creds checklist.
2. **F3 — `run-v`/`peekv` (validate the draft).** Lowest blast radius (observe-only), already written;
   live-validate against `sentry`, fix, commit. Proves plumbing F1 reuses.
3. **F1 — `cg runi`.** Interactive dispatch on the proven seeding + the git reliability of F4.
4. **F2 — notifications.** Runs as a parallel track from the start (different surfaces); its
   `Notification` "needs you" ping is most useful once F1 exists, so land F2's last mile alongside F1.

Concretely this is **two build waves** (see "Wave plan"), not one all-parallel wave, because of the
intra-track serial deps (F4 → others; F3 → F1; bus-schema → Cowork-read).

## Per-feature build notes

### F1 — `cg runi` (interactive delegated dispatch)
- New `cockpit.sh` verb: launch **interactive** `claude` (no `-p`) in tmux on the box, `--rc` on,
  `--permission-mode bypassPermissions`. Seed the directive base64-safe (decode on box → `tmux
  send-keys -l`), mirroring `run-b64`'s zero-quoting surface. Reserve `-p`/`run` for autonomous jobs.
- Leaves a live, steerable session: `cg attach <name>` (ssh keyboard control) + `/rc` (phone/browser).
  bypassPermissions + a STOP-gated prompt → autonomous-until-STOP, then **continued in the same
  session with context** (no fresh dispatch that re-reads everything).
- `/rc` URL capture into the reporter sidecar already works (Phase B) — verify it fires for `runi`.
- **Open design point:** directive-seeding mode (see Decision 3).

### F2 — run-finished notifications (loop-closer)
Three sub-parts, each a session:
- **F2-a Hook + push.** A `Stop`/`SessionEnd`/`Notification` hook installed **once per machine**
  (committed setup script + `~/.claude/settings.json` snippet under `deploy/`). Fires in headless
  `cg run`, `cg runi`, and local Mac sessions, every project, zero per-project setup. On completion it
  (1) pushes to the human (channel per Decision 1) carrying the `/rc` link, and (2) POSTs a completion
  record to the bus (see F2-b). Zero-dep bash (`curl` + `jq`), matching the reporter's no-deps ethos.
- **F2-b Bus ingestion path.** The hook POSTs to `ingest` with the machine's reporter token, carrying
  `last_assistant_message` + `rc_url` + cwd/branch/session-id. Event-store + dedup design = Decision 4.
  **Schema-touching → planner-owned:** this session *proposes* the migration and STOPs; it does not
  apply it (conventions §frozen-data-layer).
- **F2-c Cowork read (last mile).** Document + implement the Supabase-MCP read pattern that surfaces
  recently-finished jobs + their final message to a Cowork session (on demand, or one global scheduled
  task). May be a Cowork-side artifact/scheduled task rather than a CC session (see Wave plan).
- **Backstop & no-double-notify (by construction):** the **human push comes only from the hook**; the
  reporter's finished-detection only guarantees the bus shows `finished` (no push), so a crash/kill
  that skips the hook still lands a record — just without the rich message. No reconciliation race on
  the notification itself; the only reconcile needed is the finished-row idempotency in `ingest`
  (Decision 4).

### F3 — `run-v`/`peekv` streaming dispatch
- Validate the drafted `cockpit.sh run-v` (`--output-format stream-json` dispatch) + Mac-side
  `ops/render-stream.py` (live play-by-play renderer) against the live box. Fix, then commit (both are
  currently uncommitted in `portfolio`). Observe-only sibling of `runi`.

### F4 — box-session git reliability
- **Root cause:** prompt ordering — "STOP and report" preceded "commit," so sessions halted with
  uncommitted work. **Fix:** bake **commit-on-branch-BEFORE-the-STOP-gate** into
  `PROMPT_fleet_conventions.md` and the `runi`/`run` prompt templates.
- **Push creds:** verify `sentry` has working git push credentials for the delegated repos so
  artifacts sync via `git push` (not manual `cg artifact` ferrying). *Cannot verify from this planning
  session (no box access)* — the session must check on the Mac/box and document the result.

## Decisions

**Resolved 2026-06-22 (review):**

1. **Notification channel → ✅ desktop banner + ntfy-over-Tailscale.** Desktop = zero-infra immediate;
   ntfy = cross-device push on the existing Tailscale layer; Slack deferred. *Build dependency to
   confirm in F2-a:* a self-hosted ntfy reachable on the tailnet (stand one up if absent — the hook
   then `curl`s a topic).
3. **`cg runi` directive-seeding → ✅ seed-and-submit via `send-keys -l`.** Decode b64 on box →
   `send-keys -l` → Enter; the session runs autonomously **until its prompt's STOP gate** (the gate is
   the confirmation point), preserving "delegate and walk away." Mirrors `run-b64`'s zero-quoting surface.
4. **Event store → ✅ reuse `ingest` → `fleet_jobs` + `fleet_job_links`.** Completion is already a
   `status:"finished"` job row (public). `last_assistant_message` is sensitive output → **private**
   `fleet_job_links` (add a `last_message` column, or reuse `log_tail`), alongside `rc_url`. **Net
   schema change: at most one private column.** A dedicated `fleet_events` table is **deferred** until a
   second event type (the `Notification` "needs you" alert) needs it.
   - **Still must fix in F2-b — finished-row idempotency:** `ingest` matches existing jobs by
     `status='running'`, so a hook posting `status:"finished"` finds no running row → inserts a
     *duplicate* finished row (and the reporter may post its own). Idempotency key TBD in F2-b: match
     the most-recent row for `(machine,name)` regardless of status, or key on the tmux/session id.

**Recommended, confirm at prompt-writing:**

2. **Build vs adopt the hook → roll our own thin hook script.** Off-the-shelf
   (`claude-notifications-go`, `code-notify`) only do the *human push* — none write the structured
   record into the fleet bus, which is the half that closes the loop to Cowork. A ~30-line zero-dep
   bash script does both; optionally borrow their ntfy-push snippet.
5. **Hook event choice → `SessionEnd`** as the completion signal (fires once, headless + interactive;
   `Stop` fires every turn in interactive → noisy), plus **`Notification`** for the "needs you" ping
   (the F1 STOP-gate pause). Hooks don't fire on hard kill → reporter backstop.

## Session breakdown (CC-session-sized prompts under `ops/prompts/`)

Each is one self-contained `PROMPT_fleet_phaseD_*.md`, reads `PROMPT_fleet_conventions.md` first, owns
one branch, validates → STOP & reports. **Not written yet — listed for review.**

| Prompt | Feature | Branch | Repo / surface | Notes |
|---|---|---|---|---|
| `PROMPT_fleet_phaseD_git.md` | F4 | `feat/fleet-phaseD-git` | fleet docs + portfolio cockpit/creds | edits conventions ordering + box push-creds checklist; small |
| `PROMPT_fleet_phaseD_runv.md` | F3 | `feat/fleet-phaseD-runv` | portfolio `cockpit.sh` + `render-stream.py` | validate draft vs live box, fix, commit |
| `PROMPT_fleet_phaseD_runi.md` | F1 | `feat/fleet-phaseD-runi` | portfolio `cockpit.sh` | needs F3 seeding proven; `--rc`, b64 send-keys, STOP-gate |
| `PROMPT_fleet_phaseD_hook.md` | F2-a | `feat/fleet-phaseD-hook` | fleet `deploy/` + machines | hook script + per-machine install + push + POST-to-ingest |
| `PROMPT_fleet_phaseD_bus.md` | F2-b | `feat/fleet-phaseD-bus` | fleet `supabase/` + `index.mjs` + `agent/` | event-store + idempotency; **proposes** migration, STOPs |
| `PROMPT_fleet_phaseD_cowork.md` | F2-c | `feat/fleet-phaseD-cowork` | fleet `docs/` + Cowork | Supabase-MCP read pattern / one global scheduled task |

Plus the existing **consolidate** prompt at the end (runs the allowlist parity check; merges branches
only when told).

## Wave plan (`ops/waves/`)

Two waves because of the intra-track serial deps:

- **Wave D1 — prereq (solo/fast):** `git` (F4). Optionally just done by the planner editing
  `PROMPT_fleet_conventions.md` directly + a one-session creds check, rather than a full wave.
- **Wave D2 — parallel batch (3 sessions):** `runv` (F3, track A), `hook` (F2-a, track B), `bus`
  (F2-b, track B). These touch independent files and run concurrently.
- **Wave D3 — dependents (after D2 reports + consolidate):** `runi` (F1, needs `runv`'s proven
  seeding), `cowork` (F2-c, needs the bus record format settled by `bus`).

`setup-fleet-phaseD-wave.sh` follows the Phase C launcher pattern (worktree + branch per session under
`../fleet-wt/`, seed `ops/prompts/` + `docs/`, `claude --permission-mode bypassPermissions`, directive
pasted **unsubmitted** for review). Cockpit-touching sessions (`runv`, `runi`, `git`) **run on the
Mac** — that's where `portfolio` and the box path live.

## Definition of done (Phase D control loop)

- Delegated sessions reliably **commit before STOP** and **push** so artifacts sync without manual
  `cg artifact` (F4).
- `cg runi` launches an interactive, attach-/`/rc`-steerable session that **pauses at a STOP gate and
  resumes in-context** (F1); `run-v`/`peekv` give live play-by-play (F3, committed).
- Every Code session self-reports on completion via a per-machine hook → **human push (with `/rc`
  link) + a bus record carrying its final message** (F2), with the reporter as crash backstop.
- **Cowork learns a delegated session finished and reads its result with no manual paste** (Supabase
  MCP read).
- `LOOP_CLOSER.md` flipped toward "built"; `ROADMAP.md` Phase D items checked; `HOW_IT_WORKS.md`
  updated.
