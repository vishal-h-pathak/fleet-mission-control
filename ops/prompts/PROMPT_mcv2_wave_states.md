# MCv2 — M4 chunk A: wave dispatch lifecycle + dispatch Edge Function contract (wave 3)

> MISSION CONTROL v2, wave 3 — **THE SECURITY-CRITICAL WAVE**. Read
> `ops/prompts/PROMPT_fleet_conventions.md`, then `docs/V2_PLAN.md` and
> `docs/SCHEMA_V2.md` in full. Branch: `feat/mcv2-wave-states`. Scope:
> `supabase/migrations/` (**PROPOSE only**), `supabase/functions/` (code on branch,
> **never deploy**), `docs/`. No `agent/`, no `cockpit/`, no `deploy/`. You own
> `docs/SCHEMA_V2.md` this wave. The sibling sessions (`agent-runwave`, `compose`)
> build against the contract you write — it must be exact.

## Design decision of record (operator, 2026-07-26 — do not relitigate)
Dispatch is **direct-poll**: the machine agent polls for confirmed waves; there is no
`fleet_commands` row as the trigger. Consequence, non-negotiable: `fleet_waves` is now
an EXECUTION SURFACE and must carry command-queue-grade protections — explicit operator
confirmation as the only trigger, per-machine scoping, race-safe claims, and a full
audit trail. The `merge` verb is deferred; do not add it.

## 1. Migration (PROPOSE, never apply)
- `fleet_waves.status` gains the dispatch lifecycle:
  `draft → confirmed → launching → dispatched → reviewing → done | abandoned`
  (`confirmed` = operator's explicit go, set ONLY by the authed cockpit route;
  `launching` = at least one agent has claimed work; `dispatched` = every session
  launched or terminally failed to launch). Add: `confirmed_at`, `confirmed_by`
  (operator email), `launch_error`.
- Per-session launch bookkeeping on `fleet_sessions`: `claimed_at`, `claimed_by`
  (machine id), `launched_at`, `launch_error`. Claims are conditional-update
  advisory locks: an agent claims a session with
  `update ... where id = X and claimed_at is null` semantics so two agents can never
  double-launch one session; your Edge Function enforces this server-side.
- Keep everything private/deny-all as established. Nothing joins anon or realtime.

## 2. Dispatch Edge Function (code on branch, not deployed)
A new token-authed function `dispatch` (do NOT overload `ingest`; polling and
telemetry have different failure/abuse profiles):
- `POST {action:"poll"}` → the calling machine's launchable work ONLY: sessions
  belonging to waves in `confirmed`/`launching` where `machine_id` = the authed
  machine and `claimed_at is null`, with the wave context and each session's
  registered fields (name, branch, repo, model, prompt_ref). NEVER returns another
  machine's sessions. Free-text `directive` is NOT returned — record-only by design;
  the agent constructs what runs from validated structured fields only.
- `POST {action:"claim", session_id}` → conditional claim (as above); returns
  won/lost. Winning flips the wave to `launching` if still `confirmed`.
- `POST {action:"ack", session_id, ok, error?}` → sets `launched_at` or
  `launch_error`; when a wave has no unclaimed/unlaunched sessions left, flip it to
  `dispatched` (or set wave `launch_error` if all failed).
- Strict validation on every field; same sha256 machine-token auth as `ingest`;
  every state change stamps `updated_at`.
- Extend the shared pure-logic module pattern: a `dispatch-logic.mjs` with the
  wave/session launch state machine + a Node test file covering: double-claim race,
  claim-after-abandon, partial-launch (one session fails), late ack, wrong-machine
  isolation. All tests must pass.

## 3. Contract documentation
`docs/SCHEMA_V2.md`: new wave lifecycle table (who may set each transition — operator
route vs agent vs sweeper), the dispatch function's three actions with exact
request/response JSON, the claim semantics, and the security-invariants list:
(a) `confirmed` is the sole execution trigger and only the authed cockpit route may
set it; (b) agents receive only their own machine's work; (c) directives are never
transported to agents; (d) the agent revalidates everything against its local
allowlist regardless of what the bus says — the bus is untrusted input to the agent.
Also extend the staleness sweeper's doc note: a wave stuck in `confirmed`/`launching`
past a horizon should be surfaced (propose the predicate as a doc'd follow-up for the
sweeper, do not modify the deployed sweeper function in this session).

## Acceptance (validate, then STOP and report)
1. Migration complete, idempotent-guarded, **not applied**; every new column/status
   accounted for in the doc.
2. `dispatch` function typechecks; `dispatch-logic` tests pass (list them); race
   walkthrough written out in the report.
3. SCHEMA_V2.md updated; paste the transition table in your report verbatim.
4. Nothing outside your scope touched.

> Before you STOP and report, in this exact order — never STOP dirty:
> 1. `git add -A && git commit -m "<clear message>"` on your branch.
> 2. `git push -u origin <branch>` — if push fails, note it and use `cg artifact`.
> 3. Only now STOP and report: **branch**, **commit SHA**, **push result**. Don't merge.

Do not begin until I confirm.
