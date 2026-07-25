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
(`draft|dispatched|reviewing|done|abandoned`) · `registered_by`→machines (audit: which
machine POSTed the register block; null-on-delete) · `dispatched_at` · `notes` ·
`created_at` · `updated_at`.

### `fleet_sessions` — a Code run as a work item
`id` uuid pk · `wave_id`→waves **nullable** (null = the *ungrouped* bucket) ·
`machine_id`→machines · `job_id`→`fleet_jobs` **nullable** (the machine-centric join) ·
`name` (tmux/job name; mirrors `fleet_jobs.name`) · `project` · `repo` · `branch` ·
`worktree` · `prompt_ref` (`ops/prompts/PROMPT_x.md`) · `directive` · `model` ·
`status` (`planned|running|waiting|done|reviewed|merged|rejected`) · `last_message` ·
`rc_url` · `pr_url` · `dispatched_at` · `started_at` · `ended_at` · `created_at` ·
`updated_at`.
Partial-unique `(machine_id, name) where status in ('planned','running','waiting')` — one
**active** session per (machine,name), the enrichment match key (mirrors v1's
`fleet_jobs_active_uniq`). Terminal rows are exempt so a reused branch name starts clean.

### `fleet_decisions` — append-only operator verdicts
`id` uuid pk · `session_id`→sessions (cascade) · `action`
(`approve_merge|redispatch_with_feedback|reject`) · `feedback` · `created_at`.

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
| `reviewed` / `merged` / `rejected` | unchanged (sticky) | unchanged (sticky) |

`started_at` is stamped on the first → `running`; `ended_at` on the first → `done`; both
preserve-on-null. `waiting` ("needs you") is a valid state but the hook's
`Notification`-driven signal is **out of scope for M1** — nothing sets `waiting` yet.
Operator-terminal states (`reviewed`/`merged`/`rejected`, set by cockpit decisions) are
never downgraded by a late telemetry record.

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

Only `done` sessions are eligible — the Inbox's "awaiting review" group is exactly this
status. `waiting`/`planned`/`running` sessions have no decision action in M1 (they aren't
finished work yet); already-`reviewed`/`merged`/`rejected` sessions are sticky and cannot
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
