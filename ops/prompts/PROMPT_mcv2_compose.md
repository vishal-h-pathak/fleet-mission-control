# MCv2 — M4 chunk C: Compose (wave 3) — the phone-dispatch surface

> MISSION CONTROL v2, wave 3. Read `ops/prompts/PROMPT_fleet_conventions.md`, then
> `docs/V2_PLAN.md` and `docs/SCHEMA_V2.md` **including the new dispatch contract**
> (landed by the consolidated `wave-states` chunk — missing ⇒ STOP and say so).
> Branch: `feat/mcv2-compose`. Scope: **`cockpit/` only** + `docs/` additions that are
> cockpit-specific. Do NOT edit SCHEMA_V2.md (chunk A owns it), `agent/`, `supabase/`.

## Goal
`/compose`: build a wave on your phone — pick project → pick committed prompts →
assign machine + model per chunk → preview exactly what will run → **Confirm** — and
watch it launch on `/waves`. The confirm-preview IS the human gate that replaced the
pasted-unsubmitted Terminal directive; treat its design with that seriousness.

## 1. Prompt source — committed prompts only
- A server route reads `ops/prompts/PROMPT_*.md` from each project's GitHub repo at
  `origin/main` HEAD via the GitHub REST API (contents endpoint), using a
  **fine-grained read-only token** (`COCKPIT_GITHUB_TOKEN`, contents:read on the
  fixed repo set, server-only env — never `NEXT_PUBLIC_*`). List + fetch individual
  file content for preview. Cache briefly (60s) server-side. No token configured ⇒
  Compose renders a clear "read-only: GitHub token not configured" state, everything
  else in the cockpit unaffected.
- The repo set comes from `fleet_projects` (active rows with a `repo` slug) — do not
  hard-code it in the cockpit.

## 2. Compose flow
1. Pick project (active `fleet_projects`).
2. Pick 1..N prompts; for each chunk: session name (default: prompt slug), branch
   (default `feat/<slug>`, editable, charset-constrained client- AND server-side),
   machine (from `fleet_machines`), model (`haiku`/`sonnet`/`opus`).
3. **Preview screen**: for each chunk, the exact directive template the agent will
   compose (mirror the template documented in SCHEMA_V2.md's dispatch section —
   render it, clearly labeled "composed by the agent from validated fields"), the
   prompt's full content expandable, machine/model/branch summary.
4. "Save draft" → server route (service role) writes the wave (`draft`) + sessions
   (`planned`) — same shapes the register path produces; reuse, don't fork, any
   existing insert helpers.
5. **Confirm** (separate deliberate screen): re-shows the summary; requires typing
   the wave name to arm the button; POSTs to a server route that flips `draft →
   confirmed` + `confirmed_at`/`confirmed_by` (the signed-in operator's email).
   This route is the ONLY writer of `confirmed` — assert the session's auth email is
   allowlisted (it already is, via middleware, but assert again in the route: defense
   in depth on the execution trigger).
6. After confirm, deep-link to `/waves` where the new statuses (`confirmed`,
   `launching`, `dispatched`) render with chips + the per-session
   `claimed/launched/launch_error` detail from chunk A's columns.

## 3. Guardrails
- Abandon button on `draft` and `confirmed` (pre-`launching`) waves → `abandoned`.
- No edit-after-confirm: a confirmed wave is immutable in the UI; changes = abandon +
  recompose.
- All writes via authed server routes with the service role; nothing new joins the
  client bundle; the GitHub token and service key verifiably absent from it.

## Acceptance (validate against the LIVE bus, then STOP and report)
1. Build + typecheck clean; existing cockpit tests still green; new route/flow tests
   in the house style.
2. Live: compose a real draft wave named `mcv2-w3-selftest` for project
   fleet-mission-control with ONE chunk pointing at an existing trivial committed
   prompt, machine `mac-cockpit`, model `sonnet` — save it as **draft** and STOP
   THERE: do NOT confirm it (the planner confirms it during chunk B's live drill;
   nothing may launch from this session). Show the draft's bus rows + screenshots
   (mobile + desktop) of picker, preview, and the un-armed confirm screen.
3. Grep evidence: `COCKPIT_GITHUB_TOKEN` and the service key absent from the client
   bundle.
4. Report anything the contract left ambiguous (and how you resolved it) — the doc
   wins over guesses; genuinely blocking ambiguity ⇒ STOP and ask.

> Before you STOP and report, in this exact order — never STOP dirty:
> 1. `git add -A && git commit -m "<clear message>"` on your branch.
> 2. `git push -u origin <branch>` — if push fails, note it and use `cg artifact`.
> 3. Only now STOP and report: **branch**, **commit SHA**, **push result**. Don't merge.

Do not begin until I confirm.
