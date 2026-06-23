# Cowork ingestion of completion records (Phase D / F2-c — the last mile)

> How a **Cowork** planning session learns that a delegated **Claude Code** session finished and
> reads its result — final message + `/rc` link — straight off the fleet Supabase bus, **with no
> manual paste and no per-project wiring**. This is the breadth-layer report-back: plan → delegate
> → execute → **report-back** closes itself. Read `BRIEF.md`, `SCHEMA.md`, `LOOP_CLOSER.md` first.

## The honest constraint that shapes this

**Cowork cannot be pushed to — it reads.** There is no inbound channel into a Cowork chat. So the
last mile is not a push; it is a **documented read pattern** Cowork runs on demand against the same
Supabase bus the dashboard uses. The completion *event* is already produced upstream:

- **F2-a (hook):** when any Code session ends, a per-machine `SessionEnd`/`Notification` hook writes a
  rich `finished` record — `status:'finished'` + the session's `last_message` + `rc_url` — to the bus.
- **F2-b (bus/ingest v4, deployed to prod):** that record lands idempotently. Public fields →
  `fleet_jobs`; sensitive fields (`last_message`, `rc_url`, …) → private `fleet_job_links`,
  preserve-on-null. The reporter's tmux-disappear detection is a bare backstop on the same row.

F2-c adds **no new code on the write side** — it is the read contract for the consumer.

## The two reads — split at the trust boundary the DB enforces

The completion record is deliberately split across two tables with two trust levels. This is a
property of the **data**, not just the UI (see `SCHEMA.md` → "public shell + authed controls"):

| Read | Source table | Key | Tells you | Surface |
|---|---|---|---|---|
| **Public** | `fleet_jobs` (+ `fleet_machines`) | anon/publishable **or** service-role | **THAT** a session finished — machine, session, project, finished_at, status | safe for any client |
| **Private** | `fleet_job_links` | **service-role ONLY**, behind auth | **WHAT** it said + how to steer it — `last_message` + `rc_url` | authed only, never public |

- **Public = "it finished."** `fleet_jobs` has an RLS `SELECT using(true)` policy — the anon
  (publishable) key reads it. Enough to know *something* completed and which session/project it was.
- **Private = the message + `/rc`.** `last_message` and `rc_url` live in `fleet_job_links`, which has
  RLS enabled with **zero policies** and grants revoked from anon/authenticated → **deny-all**. Only
  the `service_role` key (the ingest function and the dashboard's authed API routes) bypasses it.
  **`rc_url` is a capability** — anyone holding it can drive the live session — and `last_message` is
  raw session output. **Read these with the service-role key only, behind auth, exactly like the
  dashboard's authed routes. Never with the anon key; never surfaced to a public client.**

> The anon key is not merely row-filtered out of `fleet_job_links` — it is denied at the **grant**
> level (`permission denied for table fleet_job_links`, SQLSTATE `42501`). It cannot see the table or
> the `last_message` column at all. Validation below.

## The canonical query

Saved verbatim at [`ops/queries/cowork_finished_jobs.sql`](../ops/queries/cowork_finished_jobs.sql) —
**"delegated sessions finished in the last N hours that I haven't seen,"** parameterized by
machine / project / time. It has two blocks matching the split above: **(A) public** and **(B)
private (service-role)**. A Cowork session runs block A on demand via the Supabase MCP; the planner /
an authed route runs block B with the service-role key. Edit the three `⟨hours⟩ / ⟨machine⟩ /
⟨project⟩` slots inline. `coalesce(ended_at, updated_at)` is used so the reporter's backstop-finished
rows (NULL `ended_at`) still surface and sort.

### How a Cowork session ingests, in practice (on-demand — the recommended default)

A Cowork chat just asks *"what Code sessions finished?"* and runs **block A** through the Supabase
MCP (`execute_sql` against project `sbmsxerwgylpfkkkjtku`). Nothing stands running; the read is the
whole mechanism. It learns *that* a run finished and which project/session. To pull the **message +
`/rc`**, the private read (block B) is run with the service-role key — same trust level as the
dashboard's authed routes — by the planner or an authed API route, never inside the public client.
"Haven't seen" is handled by narrowing `⟨hours⟩` or swapping the time predicate for a
`coalesce(ended_at, updated_at) > '<last-seen-ts>'` cursor.

## Ingestion mode — pick one (on-demand is the default)

1. **On-demand Cowork read — RECOMMENDED, nothing standing.** A Cowork session runs block A (and,
   authed, block B) when you want to know. Zero setup, zero per-project wiring, no babysitting. This
   alone closes the loop with no manual paste — it is the primary mechanism. **Most of F2-c is this
   doc + the query; no committed service needed.**

2. **One global Cowork scheduled task — OPTIONAL, set up once on the account (not per project).** If
   you want finished runs surfaced *proactively* instead of pulled, schedule **a single** account-level
   task that polls the bus and posts new completions. It is global — one task covers every machine and
   every project, never wired per-run. Setup notes:
   - Schedule one recurring task (e.g. every 10–15 min) on the Cowork/Claude account.
   - Its body: run **block A** with a rolling window (e.g. `⟨hours⟩ = 1`) plus a "last-seen" cursor so
     it only reports newly-finished sessions; summarize them back into the chat/thread.
   - Keep it on the **public** read for the proactive ping ("X finished on sentry"); fetch the private
     `last_message` + `rc_url` only on demand, authed, when you actually open one — so the standing
     task never holds a capability.
   - It stays **one** task: do not fan out to per-project schedules (that is exactly the per-project
     watcher pattern this design rejects).

## Validation (structural, against the live bus — 2026-06-22)

Run on the live project `sbmsxerwgylpfkkkjtku`:

- **`last_message` is live.** `fleet_job_links` columns include `last_message text` (F2-b migration
  applied; ingest v4 deployed to prod).
- **Public read returns finished delegated jobs.** Block A returned 8 finished `claude-session` rows
  in the last 24h, e.g.:

  | machine | session | project | status | finished_at |
  |---|---|---|---|---|
  | mac-cockpit | claude-hooktest | phaseD-hook | finished | 2026-06-22 20:04:32+00 |
  | sentry | claude-154809 | — | finished | 2026-06-22 20:05:05+00 |
  | sentry | claude-155900 | — | finished | 2026-06-22 19:59:15+00 |

- **The split holds — anon cannot read the private table.** With the publishable key over PostgREST:
  - `GET /rest/v1/fleet_jobs?...` → **rows** (public read works).
  - `GET /rest/v1/fleet_job_links?select=job_id,rc_url,last_message` →
    `{"code":"42501","message":"permission denied for table fleet_job_links"}`.
  - `GET /rest/v1/fleet_job_links?select=last_message` → HTTP **401**. The anon key cannot see the
    `last_message`/`rc_url` capability columns at all.

- **`last_message` *content* read is verified separately.** No real hook-fired completion record with
  a populated `last_message` exists on the bus yet (the F2-a hook has not fired its first real
  session — `claude-hooktest` was a structural test). Reading actual `last_message` + `rc_url` for a
  finished session under the service-role key is **confirmed by the planner** once the hook fires its
  first live session; the read path (block B) and the deny-all split are already proven above.

## What was actually needed

Beyond this doc and the canonical query: **nothing**. No new table, no schema change, no Edge
Function, no per-project wiring, no standing service — the on-demand Supabase-MCP read *is* the
ingestion. The optional global scheduled task is the only standing component, and only if you want
completions pushed at you rather than pulled. No secret is committed: the doc and query reference the
service-role key by role only; the real key stays server-side per `.env.example`.
