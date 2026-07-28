# MCv2 wave 4 — cockpit flow: planning-thread links, wave close path, resume-draft, board polish

> Read `ops/prompts/PROMPT_fleet_conventions.md`, then `docs/V2_PLAN.md` and
> `docs/SCHEMA_V2.md`. Scope: **`cockpit/` EXCEPT `lib/compose/directive.mjs` and its
> test** (the sibling `dispatch-hardening` session owns those and `docs/SCHEMA_V2.md`;
> you own `docs/V2_PLAN.md` this wave — add a wave-4 section). No schema changes: the
> `fleet_waves.planner_url` column and the active-wave unique index are ALREADY applied
> live by the planner.

## 1. Planning-thread links (closes the cockpit → planner loop)
- Compose gains an optional "Planning thread URL" field on the wave step (validate
  http(s) URL shape client + server; stored in `fleet_waves.planner_url`).
- Wave headers on `/waves` (and the Inbox row's expanded detail if a session's wave has
  one) render an "Open planning thread" chip — same visual family as Open PR / Open
  /rc. Purpose, for your docs blurb: one tap from a finished wave to the Cowork
  conversation that planned it, where the operator reviews findings with the planner
  and cuts the next wave.

## 2. Operator wave-close path (today it takes planner SQL — unacceptable)
On `/waves`, wave headers gain lifecycle actions via authed server routes (service
role, `updated_at` bumped, confirm-before-write like decisions):
- `dispatched` → **Start review** (→ `reviewing`)
- `reviewing` → **Close wave** (→ `done`)
- `draft`/`confirmed` keep Abandon (exists); also allow Abandon on `dispatched` with a
  clearly-worded confirm (kill-switch semantics per SCHEMA_V2).
Follow SCHEMA_V2's transition table exactly — the operator-settable transitions are
cockpit-route-only; never let a route set `confirmed` outside the existing Compose
confirm (that stays the sole arming path).

## 3. Resume-draft → Confirm (gap flagged at M4 review)
A saved draft must be confirmable later: `/waves` draft wave rows get "Review &
confirm" navigating into the same deliberate confirm screen the wizard uses (full
summary, type-wave-name-to-arm, sole writer of `confirmed`, defense-in-depth auth
assert). One confirm implementation — reuse, don't fork; if the wizard's confirm step
is too entangled to reuse, refactor it into a shared component rather than duplicating.

## 4. Board polish (parked items, now due)
- `lost` joins the wave-header status tally (`ALL_STATUSES` / `STATUS_ORDER`) — chips
  already render it in lists; the header counts miss it.
- The 500-row session fetch: when the cap is hit, render an explicit "showing latest
  500 sessions" note instead of silently truncating.

## Acceptance (validate against the LIVE bus, then STOP and report)
1. Build + typecheck + all cockpit tests green (including the sibling-owned directive
   parity test — you must not have touched its inputs).
2. Live: save a throwaway draft wave (project fleet-mission-control, name
   `mcv2-w4-flowtest`, any committed prompt, WITH a planner_url) → leave the wizard →
   resume it from /waves → walk to the armed-but-unclicked confirm screen → then
   Abandon it. Show the chip rendering, the resume path, and the abandoned end state
   (screenshots mobile + desktop; report the wave id for planner cleanup).
3. Exercise Start review → Close wave live on the already-`dispatched` `mcv2-guide`
   wave ONLY if the operator has finished reviewing it; otherwise demonstrate on your
   throwaway before abandoning it and say so.
4. Service-role key and GitHub token still absent from the client bundle (grep proof).

> Before you STOP and report, in this exact order — never STOP dirty:
> 1. `git add -A && git commit -m "<clear message>"` on your branch.
> 2. `git push -u origin <branch>` — if push fails, note it and use `cg artifact`.
> 3. Only now STOP and report: **branch**, **commit SHA**, **push result**. Don't merge.
