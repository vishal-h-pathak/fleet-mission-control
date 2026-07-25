# MCv2 — M3: Waves board + Inbox polish (wave 2, chunk A)

> MISSION CONTROL v2, wave 2. Read `ops/prompts/PROMPT_fleet_conventions.md` first, then
> `docs/V2_PLAN.md` and `docs/SCHEMA_V2.md`. Branch: `feat/mcv2-waves-board`. Scope:
> **`cockpit/` only.** Do NOT edit `docs/SCHEMA_V2.md` this wave — the sibling
> `hardening` session (`feat/mcv2-hardening`) owns all schema/doc changes; build to the
> contract additions listed below and coordinate on them.

## Goal
The live board: "what is the fleet doing right now, wave by wave" — plus the Inbox polish
items wave 1 surfaced. Cockpit remains an index + decision surface: diffs stay on GitHub,
steering stays on `/rc`.

## 1. Waves board (`/waves`)
- Sessions grouped **project → wave** (waves newest-first; "ungrouped" as a pseudo-wave
  per project), each session row: name, status chip (all seven statuses — **planned rows
  are first-class here**, that's this board's job), branch, machine, model, relative
  times, Open PR / Open /rc links when present.
- Wave header: name, status, dispatched_at, notes, counts by session status.
- A one-line machine-status rail (from `fleet_machine_status`, service-role server route)
  at the top — one line, not a centerpiece.
- Nav between `/` (Inbox) and `/waves`; same auth/middleware/polling patterns as Inbox.
  Mobile-first, dark, dense.

## 2. Inbox polish (backlog from wave 1, all confirmed by the operator)
- **Dismiss** on ungrouped/no-op sessions: writes `fleet_decisions(action='dismissed')`
  and transitions the session → `reviewed`, exactly like the other decision actions.
  CONTRACT NOTE: `'dismissed'` is being added to the `fleet_decisions.action` check by
  the sibling session's proposed migration, which the planner applies at consolidation —
  build the UI + route now, and if your live test 400s on the constraint, record that as
  expected-pending-migration in your report, don't work around it.
- **Decision routes must set `updated_at = now()`** on the session row (wave-1 bug: the
  schema approval left a stale timestamp).
- Migrate `middleware.ts` → the `proxy` convention (Next 16 deprecation) with identical
  coverage; show the redirect tests still pass.

## Acceptance (validate against the LIVE bus, then STOP and report)
1. Build + typecheck clean; auth still gates every route including `/waves`.
2. `/waves` renders the real wave-1 wave (`mcv2-wave1`, its three reviewed sessions) and
   the ungrouped bucket, mobile + desktop screenshots.
3. A decision write demonstrably bumps `updated_at`. Dismiss path exercised as far as the
   constraint allows (see contract note).
4. Service-role key still absent from the client bundle (grep the build output).

> Before you STOP and report, in this exact order — never STOP dirty:
> 1. `git add -A && git commit -m "<clear message>"` on your branch.
> 2. `git push -u origin <branch>` — if push fails, run `cg artifact <path>` as the fallback and note it.
> 3. Only now STOP and report: **branch**, **commit SHA**, and **push result**. Don't merge.

Do not begin until I confirm.
