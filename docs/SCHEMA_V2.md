# Fleet Mission Control — schema v2 (work-centric spine)

> Binding contract for MCv2 M1. The `cockpit/` app, the `inbox` session, and every
> later wave build from THIS doc. Companion to `docs/SCHEMA.md` (the v1 machine-centric
> model, unchanged). Lives in the shared Supabase project `sbmsxerwgylpfkkkjtku`,
> `fleet_`-prefixed. Status: **PROPOSED 2026-07-22 — migrations not yet applied.**

## Model

v2 adds a **work-centric spine** — Project → Wave → Session → Decision — joined to (not
replacing) the v1 machine-centric tables (`fleet_machines`/`fleet_jobs`/`fleet_job_links`).

```
fleet_projects ──< fleet_waves ──< fleet_sessions ──< fleet_decisions
                                        │
                                        └── job_id ──> fleet_jobs   (v1 join, nullable)
```

## Security — all four tables are PRIVATE

RLS enabled, **zero policies** (deny-all), grants revoked from `anon`/`authenticated`.
Only `service_role` (the `ingest` function + authed cockpit server routes) reads/writes.
None join the realtime publication or the anon surface. Same posture as
`fleet_machine_secrets` / `fleet_job_links`; the "RLS enabled, no policy" linter notice
on all four is **intended**. `pr_url` (new, on both `fleet_sessions` and
`fleet_job_links`) is sensitive like `rc_url` — a draft-PR URL leaks repo + branch +
content — and never leaves a service-role context.

## Tables

### `fleet_projects` — dispatchable repo registry
`id` uuid pk · `name` unique · `repo` (`owner/name` github slug) · `default_branch`
(default `main`) · `active` bool · `created_at` · `updated_at`. Seeded idempotently with
the known fleet (fleet-mission-control, portfolio, cellular-gaits, jobify, caddiehack,
camera-whispr-llm; owner `vishal-h-pathak`).

### `fleet_waves` — a dispatched set of sessions
`id` uuid pk · `project_id`→projects · `name` · `status`
(`draft|confirmed|launching|dispatched|reviewing|done|abandoned`) ·
`registered_by`→machines (audit: which machine POSTed the register block;
null-on-delete) · `dispatched_at` · `notes` · `created_at` · `updated_at` ·
**M4 dispatch:** `confirmed_at` · `confirmed_by` (operator email) · `launch_error`.
As of M4 this table is an **execution surface** — see "Wave dispatch lifecycle (M4)"
below for the lifecycle, the who-may-set-what table, and the security invariants.

### `fleet_sessions` — a Code run as a work item
`id` uuid pk · `wave_id`→waves **nullable** (null = the *ungrouped* bucket) ·
`machine_id`→machines · `job_id`→`fleet_jobs` **nullable** (the machine-centric join) ·
`name` (tmux/job name; mirrors `fleet_jobs.name`) · `project` · `repo` · `branch` ·
`worktree` · `prompt_ref` (`ops/prompts/PROMPT_x.md`) · `directive` · `model` ·
`status` (`planned|running|waiting|done|reviewed|merged|rejected|lost`) · `last_message` ·
`rc_url` · `pr_url` · `dispatched_at` · `started_at` · `ended_at` · `created_at` ·
`updated_at` · **M4 dispatch:** `claimed_at` · `claimed_by`→machines · `launched_at` ·
`launch_error`.
Partial-unique `(machine_id, name) where status in ('planned','running','waiting')` — one
**active** session per (machine,name), the enrichment match key (mirrors v1's
`fleet_jobs_active_uniq`). Terminal rows (including `lost`) are exempt so a reused
branch name starts clean.

`lost` (wave 2 hardening): a Terminal/GUI Code session killed abruptly never fires
SessionEnd, so without this status its row would sit `running`/`planned` forever —
the reporter's tmux crash-backstop only covers tmux-tracked jobs. A `pg_cron`
sweeper (`fleet_sweep_stale_sessions()`, `supabase/migrations/20260725183624_fleet_mcv2_lost_status_sweep.sql`,
every 30 min) flips demonstrably-stale rows to `lost` under hard guardrails: never
touches `done` or any operator-terminal row; `running`→`lost` requires BOTH no
*live* linked `fleet_jobs` row (status `running` **and** heartbeated within the
last 30 minutes — recency, not just status, since a one-shot GUI session's job row
can sit at `status='running'` forever with no further heartbeat ever updating it)
**and** the session itself untouched for ≥12h; `planned`→`lost` requires
`dispatched_at` ≥48h old (no job exists yet for a planned session, so no job-side
check applies). `lost` is **telemetry-terminal like `done`**: excluded from the
partial-unique/match-ladder tiers 2–3 above, so a later real record for the same
(machine,name) starts a fresh session rather than reopening it — see "Ingest v5 —
session enrichment" below for why the sweeper also closes the linked `fleet_jobs`
row, which is required (not incidental) for that guarantee to hold.

### `fleet_decisions` — append-only operator verdicts
`id` uuid pk · `session_id`→sessions (cascade) · `action`
(`approve_merge|redispatch_with_feedback|reject|dismissed`) · `feedback` · `created_at`.
`dismissed` (wave 2 hardening) is the cockpit's noise-dismiss action — the
waves-board sibling wave builds the UI; see the operator-driven transition table
below for its effect on `fleet_sessions.status`.

### v1 touch-up
`fleet_job_links.pr_url` text — the auto-PR hook's PR URL, private tier (see below).

## Authority rule (why the same field lives in two tables)

**`fleet_sessions` is authoritative for the work-centric read model the cockpit reads:**
`status`, `last_message`, `rc_url`, `pr_url`. **`fleet_job_links` keeps its own copy**
for the existing machine-centric v1 dashboard, unchanged.

They cannot drift: both are written **from the same job record in the same `ingest`
pass**, with identical **preserve-on-null** semantics — neither is derived from the
other. When a session has a linked `job_id` they agree by construction. The duplication
is deliberate, not laziness: a launcher-registered `planned` session exists *before* any
`fleet_jobs` row, and ungrouped sessions carry these fields locally — a join to
`fleet_job_links` can serve neither. The cockpit reads `fleet_sessions`; the v1 dashboard
reads `fleet_job_links`; each is authoritative for its own surface.

## Ingest v5 — session enrichment

For each `jobs[]` entry with `kind: "claude-session"`, after the v1 `fleet_jobs` upsert
yields a `jobId` that is **stable across one running→finished lifecycle and fresh for a
new one** (v1's existing guarantee), enrich `fleet_sessions` via this **match ladder**
(first hit wins; ingest short-circuits):

1. **`job_id = jobId`** — the anchor. Once a session is bound to a job, every later
   record for that lifecycle (running heartbeat, hook `finished`, bare reporter backstop)
   updates the same row, whatever its current status.
2. **`(machine_id, name)`, non-terminal** — a launcher-registered `planned` session's
   first touch, or a tmux session whose `JOB_NAME` equals the registered name.
3. **`(machine_id, project, branch)`, non-terminal** — *Terminal.app fallback*. Sessions
   run outside tmux report `JOB_NAME = claude-<session_id:0:8>`, which never matches a
   registered name; match the planned session by its **branch** instead. Requires the
   record to carry both `project` and `branch` (the hook sends `branch` via a
   consolidation amendment; **`branch` is optional — old hooks stay valid** and simply
   skip this rung).
4. **else create an ungrouped session** (`wave_id` null) so out-of-launcher dispatches
   still surface.

On match, the row is bound (`job_id = jobId`), its `name` refreshed to the live session
name, private fields filled preserve-on-null, and status advanced per the table below.

### Status transitions

| Session status (current) | running record | terminal record (`finished`/`failed`/`stopped`) |
|---|---|---|
| `planned`  | → `running` | → `done` |
| `running`  | `running` (fill fields) | → `done` |
| `waiting`  | `running` | → `done` |
| `done`     | `done` (no reopen) | `done` |
| `lost`     | `lost` (no reopen) | → `done` |
| `reviewed` / `merged` / `rejected` | unchanged (sticky) | unchanged (sticky) |

`started_at` is stamped on the first → `running`; `ended_at` on the first → `done`; both
preserve-on-null. `waiting` ("needs you") is a valid state but the hook's
`Notification`-driven signal is **out of scope for M1** — nothing sets `waiting` yet.
Operator-terminal states (`reviewed`/`merged`/`rejected`, set by cockpit decisions) are
never downgraded by a late telemetry record.

`lost` (wave 2 hardening, set by the `pg_cron` sweeper, never by ingest itself) behaves
exactly like `done` in this table: a stray running record never reopens it (guards
against an out-of-order heartbeat arriving after the sweep already gave up), while a
genuine late terminal record still flips it to `done` — reachable only via the job_id
anchor (tier 1), since `lost` is excluded from the (machine,name)/(machine,project,branch)
match tiers (2–3) same as `done`. `session-logic.mjs`'s `nextSessionStatus`:
```js
if (SESSION_OPERATOR_TERMINAL.has(cur)) return cur;
if (isTerminal) return "done";
if (cur === "done" || cur === "lost") return cur;
return "running";
```

### Status transitions — operator-driven (cockpit, M2 Inbox)

Distinct from the ingest-driven table above: these three transitions are written by the
cockpit's authed decision routes (service-role, never ingest), each pairing an append-only
`fleet_decisions` insert with a guarded `fleet_sessions.status` update (`... where status =
'done'`, so a session can only be decided once — a race loses cleanly rather than
double-deciding).

| Decision action (`fleet_decisions.action`) | Session status (must be `done`) → | Notes |
|---|---|---|
| `approve_merge` | → `reviewed` | operator approved; merge itself stays a manual/out-of-band step in M1 |
| `redispatch_with_feedback` | → `reviewed` | `feedback` (required, non-blank) recorded on the decision row; re-dispatch itself is a later milestone's verb (M4 `run-wave`), not this table |
| `reject` | → `rejected` | terminal; no further ingest record ever reopens it (see the sticky-operator-terminal rule above) |
| `dismissed` | → `reviewed` | wave 2 hardening: the cockpit's noise-dismiss action (e.g. a stray/uninteresting `done` row) — same target status as `approve_merge`, distinguished only by `fleet_decisions.action` for audit; UI lands in the waves-board sibling wave |

Only `done` sessions are eligible — the Inbox's "awaiting review" group is exactly this
status. `waiting`/`planned`/`running`/`lost` sessions have no decision action in M1 (they
aren't finished work eligible for review — a `lost` session has no diff to review by
construction); already-`reviewed`/`merged`/`rejected` sessions are sticky and cannot
be re-decided.

### Race matrix (all paths converge on ONE row)

Anchored by step 1 (`job_id`); `pr_url`/`rc_url`/`last_message` preserve-on-null in both
`fleet_sessions` and `fleet_job_links`.

| Case | Sequence | Result |
|---|---|---|
| Registered, reporter-first | planned → running(2) binds job_id → finished(1) | 1 row, `done`, grouped |
| Registered, hook-first | planned → finished(2) binds job_id, `done` → late bare backstop(1) | 1 row, `done`, fields preserved |
| Registered, Terminal.app | planned(name=X) → running(2b via branch) binds job_id, name→live → finished(1) | 1 row, `done`, grouped |
| Unregistered, reporter-first | running(3) creates ungrouped → finished(1) | 1 row, `done`, ungrouped |
| Unregistered, hook-only | finished(3) creates ungrouped `done` → late backstop(1) | 1 row, `done` |
| Name reuse after done | done row exists → new running(1 miss,2 miss→3) | new row; old `done` untouched |
| Operator decided | `merged` → straggler finished(1) | stays `merged` |
| Name reuse after lost | sweep: running→lost, closes job → new running(1 miss,2 miss→3) | new row; old `lost` untouched — **requires** the sweep to also close the linked `fleet_jobs` row (see `lost` semantics above), else the new record's v1 upsert would silently rebind to the dead job_id and hit tier 1 |
| Late terminal after lost | running→lost(sweep, job closed) → finished(1, v1 by-name terminal fallback reunites with the closed job) | 1 row, `done`, `lost`→`done` via job_id anchor |
| Late non-terminal race after lost | running→lost(sweep) → a running record still carrying the dead job_id (replay/race) | stays `lost` (job_id anchor finds it, `nextSessionStatus` refuses to reopen a non-operator-terminal telemetry-terminal row on a non-terminal record — mirrors `done`) |

## Ingest v5 — wave registration (`register` block)

A launcher records a dispatched wave of `planned` sessions by POSTing to the **existing**
`ingest` endpoint (same per-machine bearer token; `heartbeat`/`jobs` optional). Chosen
over a separate Edge Function: one auth surface, one deploy, consistent with ingest's
existing multiplexing. It **records intent only — no string is executed anywhere**;
dispatch stays in the launcher.

```jsonc
{
  "register": {
    "project": "portfolio",            // name (upserted by name) — or "project_id": "<uuid>" (must exist)
    "wave": { "name": "mcv2-wave1", "notes": "…", "status": "dispatched" },  // status optional, default dispatched
    "sessions": [
      { "name": "feat/x",              // required; charset [A-Za-z0-9._/-]{1,200}
        "machine": "sentry",           // optional; resolved by name → machine_id; default = the authed machine
        "project": "portfolio", "repo": "owner/name", "branch": "feat/x",
        "worktree": "../pf-wt/x", "model": "sonnet",
        "prompt_ref": "ops/prompts/PROMPT_x.md", "directive": "…" }
    ]
  }
}
```

Validation: sessions non-empty and ≤100; wave name required (≤200); project resolvable;
each session name charset-checked; an explicitly-named unknown `machine` **errors** (catch
typos at dispatch). `registered_by` on the wave = the authed machine. Idempotent: a
still-active session with the same `(machine_id, name)` is reused (planning fields
refreshed, lifecycle status untouched), so a re-run doesn't duplicate.

Response (200): `{"ok":true, …, "registered": {"wave_id","project_id","sessions":[{"id","name"}]}}`.
Error (400/500): `{"error":"register_<reason>"}`; the whole registration is rejected
before any session write on a validation failure (wave insert is the first write).

## Wave dispatch lifecycle (M4) — `fleet_waves` as an execution surface

> **Design decision of record (operator, 2026-07-26).** Dispatch is **direct-poll**:
> the machine agent polls the `dispatch` Edge Function for confirmed waves. There is
> no `fleet_commands` row acting as the trigger. Consequence, non-negotiable:
> `fleet_waves` stops being a passive record of a launch that already happened (the
> v1 `register` semantics above) and becomes an **execution surface**, so it carries
> command-queue-grade protections — explicit operator confirmation as the only
> trigger, per-machine scoping, race-safe claims, full audit trail. The `merge` verb
> is deferred and is not part of this contract.

### Wave status transition table

Who may set each transition. "Cockpit route" = an authed, operator-only server route
(service-role, allowlisted owner email). "Agent" = the `dispatch` Edge Function acting
on a token-authed machine's request. `→` rows not listed are **not reachable**.

| From | To | Who may set it | Trigger / guard |
|---|---|---|---|
| — | `draft` | cockpit route (Compose) | a composed-but-unarmed wave. Inert: never polled. |
| — | `dispatched` | ingest `register` block (machine token) | **legacy path, unchanged**: the Mac launcher already ran the sessions and is recording them. Never passes through `confirmed`. |
| `draft` | `confirmed` | **cockpit route ONLY** | the operator's explicit go — the sole execution trigger. Stamps `confirmed_at` + `confirmed_by`; a DB check constraint rejects `confirmed` without both. |
| `confirmed` | `launching` | agent (`claim`, on win) | first successful claim on any of the wave's sessions. Guarded `where status = 'confirmed'`, so concurrent winners are idempotent. |
| `launching` | `launching` | agent (`claim`/`ack`) | further claims/acks while any session is still pending. |
| `confirmed`/`launching` | `dispatched` | agent (`ack`) | no session is pending any more (every one has `launched_at` **or** `launch_error`). Sets wave `launch_error` = `"<n>/<total> sessions failed to launch"` when n ≥ 1. |
| `dispatched` | `reviewing` → `done` | cockpit route | post-launch review flow (unchanged from v1). |
| any | `abandoned` | cockpit route | the kill switch. `abandoned` is **not launchable**, so it stops further claims immediately, mid-flight included. |
| `confirmed`/`launching` | *(stuck)* | staleness sweeper (doc'd follow-up, below) | surfaced, not auto-transitioned. |

The agent side can **only** move a wave `confirmed → launching → dispatched`. It can
never write `confirmed`, never resurrect `abandoned`/`done`, and never regress a wave
the operator has moved on (every wave write is guarded on the status just read, so a
stale conclusion loses cleanly instead of overwriting).

### Session launch bookkeeping + claim semantics

`claimed_at`/`claimed_by` are a **conditional-update advisory lock**. The lock is the
UPDATE, not the read that precedes it:

```sql
update fleet_sessions
   set claimed_at = now(), claimed_by = $auth_machine
 where id = $session_id
   and machine_id = $auth_machine     -- invariant (b), re-asserted at write time
   and claimed_at is null             -- the lock
   and status = 'planned'             -- never relaunch work that already ran
```

Exactly one caller matches a row; the loser matches zero and stands down. The
function's pre-read exists only to produce a useful refusal *reason* — correctness
rests entirely on this statement, which the database serializes.

**Compensating re-check.** PostgREST cannot join the wave's status into that UPDATE,
so a wave abandoned *between* the read and the write would otherwise leave a live
claim on dead work. After winning, the function re-reads the wave; if it is no longer
launchable it **releases the claim** (`where claimed_by = $auth_machine`, so it can
only ever undo its own) and reports `wave_not_launchable`. Fail-closed: an unexpected
read failure also releases.

**A failed launch keeps its claim.** `launch_error` is terminal for the launch phase:
the session is not re-offered by `poll`, so a broken launch can never become a
relaunch loop. Recovery is an explicit operator re-dispatch, not an automatic retry.

**`launched_at` is preserve-on-null** — a duplicate or late ack never restamps it. A
success ack clears a prior `launch_error` (an agent that retried and won).

### `dispatch` Edge Function — the three actions

`POST /functions/v1/dispatch`, `Authorization: Bearer <per-machine token>` (sha256 →
`fleet_machine_secrets`, identical to `ingest`/`commands`; `verify_jwt` OFF, auth
enforced in-function). **A separate function from `ingest` by design**: ingest is a
write-only telemetry sink whose worst case is bad data; this is an execution surface
whose worst case is unauthorized code running on a box. Different abuse profiles →
different blast radii, logs, and rollback. Errors are `4xx/5xx` with
`{"error":"<reason>"}`; a *refused claim* is a **200** with `won:false` (it is a
normal race outcome, not a fault). Every success response carries
`{"ok":true,"machine_id":"<uuid>","at":"<iso>"}` plus the action's own fields.

**`poll`** — this machine's launchable work. Bounded to 50 rows; the rest comes on the
next poll. Also stamps `fleet_machines.last_seen_at` (polling proves liveness).

```jsonc
// request
{ "action": "poll" }

// 200
{ "ok": true, "machine_id": "…", "at": "2026-07-26T…Z",
  "work": [
    { "wave":    { "id": "…", "name": "mcv2-wave3", "status": "confirmed",
                   "project_id": "…",
                   "project": { "name": "portfolio", "repo": "owner/portfolio",
                                "default_branch": "main" } },
      "session": { "id": "…", "name": "feat/x", "project": "portfolio",
                   "repo": "owner/portfolio", "branch": "feat/x",
                   "worktree": "../pf-wt/x", "model": "sonnet",
                   "prompt_ref": "ops/prompts/PROMPT_x.md" } }
  ] }
```

Selection predicate: `fleet_sessions.machine_id = <authed machine>` **and**
`claimed_at is null` **and** `status = 'planned'` **and** the parent wave's status ∈
{`confirmed`,`launching`}. The session object is **built from an allowlist**
(`POLL_SESSION_FIELDS` = id, name, project, repo, branch, worktree, model,
prompt_ref) — not by stripping fields — so a column added to `fleet_sessions` later
cannot leak by default. **`directive`, `last_message`, `rc_url` and `pr_url` are never
present.**

**`claim`** — take the advisory lock on one session.

```jsonc
// request
{ "action": "claim", "session_id": "<uuid>" }

// 200 — won
{ "ok": true, "machine_id": "…", "at": "…", "won": true, "session_id": "<uuid>" }

// 200 — lost (a normal outcome, not an error)
{ "ok": true, "machine_id": "…", "at": "…", "won": false, "reason": "already_claimed" }
```

`reason` ∈ `unknown_session` · `wave_not_launchable` · `session_not_launchable` ·
`already_claimed`. **A session belonging to another machine returns `unknown_session`,
identical to a nonexistent one** — invariant (b) covers information too: an agent must
not be able to probe which session ids exist elsewhere in the fleet. Winning flips the
wave `confirmed → launching`.

**`ack`** — record what actually happened to the launch, and complete the wave.

```jsonc
// request
{ "action": "ack", "session_id": "<uuid>", "ok": true }
{ "action": "ack", "session_id": "<uuid>", "ok": false, "error": "tmux: session exists" }

// 200
{ "ok": true, "machine_id": "…", "at": "…", "wave_status": "dispatched" }
```

`ok` must be a boolean; `error` is optional, string, truncated to 2000 chars
(defaulting to `"launch_failed"`). Errors: `ack_unknown_session` (missing, or another
machine's) · `ack_not_claimed` (nobody holds the claim, or another machine does) —
**only the machine that won the claim may ack it**.

`ack` is deliberately weaker than `claim` in exactly two ways, both required for the
audit trail to survive real timing: it does **not** check the wave's status (a late
ack on an already-`dispatched` or `abandoned` wave must still record the session's
outcome — the wave update is a separate, guarded step that simply no-ops), and it does
**not** check the session's status (by ack time, ingest may already have flipped it
`planned → running` from the launched process's own telemetry — that is the success
path, not an error).

### Security invariants

- **(a) `confirmed` is the sole execution trigger, and only the authed cockpit route
  may set it.** The `dispatch` function never writes `confirmed`. The ingest
  `register` block cannot either: its accepted-status list
  (`session-logic.mjs` `WAVE_STATUSES`) deliberately excludes `confirmed`/`launching`
  and falls back to `dispatched`, so a *machine token can never arm work* — only an
  authenticated operator can. Unit-tested (`the ingest register block cannot arm a
  wave`). A DB check constraint additionally rejects any `confirmed` row lacking
  `confirmed_at` + `confirmed_by`: no anonymous arming, ever.
- **(b) Agents receive only their own machine's work.** The authed `machine_id` comes
  from the token and *nothing in the request body can name a machine*. It is the first
  filter on `poll` and is re-asserted inside the claim/ack UPDATEs. Cross-machine ids
  are indistinguishable from nonexistent ones.
- **(c) Directives are never transported to agents.** `fleet_sessions.directive` is
  record-only by design. The agent constructs what it runs from validated structured
  fields alone. Enforced by allowlist projection, not filtering (see `poll`).
- **(d) The agent revalidates everything against its local allowlist regardless of
  what the bus says — the bus is untrusted input to the agent.** Model, repo,
  worktree path, prompt_ref and branch are all re-checked machine-side against
  `agent/allowlist.mjs` before anything is spawned (`shell:false`, fixed repo set).
  The poll response includes the wave's project registry entry precisely so the agent
  can cross-check the session's own `repo` against it. A compromised or buggy bus row
  must not be sufficient to run code.

### Staleness sweeper — doc'd follow-up (not implemented this wave)

`fleet_sweep_stale_sessions()` (deployed, wave 2) covers stale *sessions* only. The
dispatch lifecycle adds a wave-level stall: a wave armed by the operator that no agent
ever picks up (machine offline/asleep) sits in `confirmed` forever, and one whose
agent dies mid-launch sits in `launching` forever — in both cases the cockpit shows
armed work that will never run. **Proposed predicate, to be added to the sweeper in a
later wave (do not apply here):**

```sql
-- surface, do NOT auto-transition: armed work that never launched is an operator
-- decision (retry vs abandon), not something a cron job should resolve.
select w.id, w.name, w.status, w.confirmed_at
  from public.fleet_waves w
 where w.status in ('confirmed','launching')
   and w.confirmed_at < now() - interval '2 hours';
```

Two hours is generous against a sleeping laptop while still catching a genuinely dead
dispatch within one cockpit session. Surfacing (an Inbox/waves-board "stalled" badge,
optionally an ntfy push) is the right response — auto-abandoning armed work would
silently discard an operator's explicit go, and auto-retrying would relaunch work
whose first attempt may have partially succeeded.

## `pr_url` contract (with the `hook-pr` sibling — M0)

The auto-draft-PR hook adds `"pr_url": "<url>"` to its existing `jobs[]` entry (SENSITIVE,
same tier as `rc_url`). Ingest v5 routes it to **private storage** — `fleet_job_links.pr_url`
**and** `fleet_sessions.pr_url` — preserve-on-null. Old hooks that omit it are unaffected.
The hook also begins sending an optional `"branch"` on the entry to power match rung 3.

## Proposed migrations (PROPOSE only — planner applies)

1. `20260722090000_fleet_mcv2_schema.sql` — the four tables, indexes, partial-unique,
   comments, idempotent project seeds.
2. `20260722090100_fleet_mcv2_rls.sql` — RLS enable + zero-policy deny-all + revoke grants.
3. `20260722090200_fleet_mcv2_pr_url.sql` — `pr_url` column on `fleet_job_links`.
4. `20260725183624_fleet_mcv2_lost_status_sweep.sql` — wave 2 hardening: adds `lost` to
   `fleet_sessions.status` and `dismissed` to `fleet_decisions.action`; adds
   `fleet_sweep_stale_sessions()` (staleness sweep, see `lost` semantics above) scheduled
   via `pg_cron` every 30 min.
5. `20260726090000_fleet_mcv2_wave_dispatch.sql` — wave 3 (M4): the dispatch lifecycle.
   Adds `confirmed`/`launching` to `fleet_waves.status` + `confirmed_at`/`confirmed_by`/
   `launch_error` (with the "no anonymous arming" check constraint), the per-session
   claim columns `claimed_at`/`claimed_by`/`launched_at`/`launch_error`, and two partial
   indexes for the poll predicate. RLS/grants unchanged — new columns inherit the
   existing deny-all posture. **Must be applied before the `dispatch` function is
   deployed**; the function is on-branch only and is NOT deployed by the building
   session.

### Known follow-up (out of scope this wave)
`cockpit/lib/inbox/types.ts`'s `SessionStatus` union (`"planned"|"running"|"waiting"|
"done"|"reviewed"|"merged"|"rejected"`) predates `lost` and needs a `| "lost"` addition
plus Inbox-grouping logic to route it somewhere sane (not "awaiting review" — a lost
session has no diff). `cockpit/` is out of this wave's scope; flagged for the
waves-board sibling wave or a follow-up.
