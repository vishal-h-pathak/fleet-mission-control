# MCv2 — M2: `cockpit/` scaffold + Inbox v1 (the default screen)

> MISSION CONTROL v2, milestone M2 — **dependent stage**: runs only after the `schema` session
> is consolidated and the planner has applied the v2 migrations + deployed ingest v5. Read
> `ops/prompts/PROMPT_fleet_conventions.md` first, then `docs/V2_PLAN.md` and
> `docs/SCHEMA_V2.md` (the contract you build against — trust it over guesses; if it's missing
> from your worktree, STOP and say so). Branch: `feat/mcv2-inbox`. Scope: **new `cockpit/`
> directory only** + `docs/` — do not touch `web/`, `supabase/`, `agent/`, `deploy/`.

## Goal
Stand up the new **authed-only operator app** and ship its default screen: the **Inbox** —
"what needs me right now" across every project and machine, phone-first. This is an index +
decision surface over existing primitives: diffs live on GitHub (deep-link), live steering
lives on `/rc` (deep-link) — never rebuild either.

## 1. Scaffold — `cockpit/`
- Next.js 16.2.3 / React 19 / Tailwind 4 / TypeScript / `@supabase/supabase-js ^2.49`
  (conventions stack — match `web/`'s versions where they're newer-compatible). Fresh
  `create-next-app`-style App Router layout; keep it lean, no component library.
- **Authed-only from the first route.** Supabase Auth (magic link) on the shared project,
  gated to allowlisted owner email(s) via env (`COCKPIT_ALLOWED_EMAILS`); middleware protects
  everything — there is NO public surface, no anon reads, nothing joins the showcase.
- **All data reads via server routes** (route handlers / server components) using the
  service-role key (server-only env, never `NEXT_PUBLIC_*`). The v2 tables are deny-all by
  design; the anon key gets the cockpit nothing, correctly.
- `cockpit/.env.example` with every key placeholdered; `cockpit/README.md` (run, envs, deploy
  intent: its own Vercel project, added later by the planner — **do not create/link a Vercel
  project or deploy**).

## 2. Inbox v1 (route: `/`, mobile-first)
Three stacked groups, most-urgent first, each row a session work-item
(project · wave (or "ungrouped") · branch · machine · model · relative time):

1. **Needs you** — status `waiting` (+ `running` shown quietly below them; a running session
   is watchable, not actionable).
2. **Awaiting review** — status `done`: collapsed summary (last_message, expandable),
   **Open PR** (pr_url, when present), **Open /rc** (rc_url), and the decision actions:
   - **Approve** → writes `fleet_decisions(action=approve_merge)` + session → `reviewed`.
     (Actual merge happens on GitHub for now — the button links there; the `merge` bus verb
     is M4, don't build it.)
   - **Redispatch with feedback** → small text field → `fleet_decisions` row
     (`action=redispatch_with_feedback`, feedback stored) + the session's status per
     `docs/SCHEMA_V2.md`'s transition table — the *dispatch* itself stays manual until M4.
     Where this sketch and the doc disagree, the doc wins.
   - **Reject** → `fleet_decisions(action=reject)` + session → `rejected`.
   Decision writes go through an authed server route using the service role; append-only,
   confirm-before-write on mobile (no fat-finger rejects).
3. **Recently decided** — last ~10 `reviewed|merged|rejected`, with their decision + links.

- Data: poll (SWR/interval ~10–15s is fine); the private tables aren't in the realtime
  publication and that's intentional — don't add them.
- Include the **ungrouped bucket** naturally (wave "ungrouped"); machine health is at most a
  one-line status rail from `fleet_machine_status` — it is NOT the centerpiece.
- Visual: dark, dense, fast; consistent with the fleet dashboard's feel but no need to share
  code. No lorem, no empty-state art — plain text empty states.

## Acceptance (validate against the LIVE bus, then STOP and report)
1. `pnpm build` (or npm — match the repo's manager) clean; typecheck clean.
2. Logged out ⇒ every route redirects to sign-in; logged in as a non-allowlisted email ⇒
   refused. Show the middleware test evidence.
3. Inbox renders REAL rows from the live v2 tables (there will be at least the wave-1 sessions
   themselves once registered, plus ungrouped completions from the hook). Screenshot mobile
   width + desktop.
4. A decision action round-trips: press Approve on a test session → `fleet_decisions` row
   exists, status flips, UI reflects it on next poll. Show the row.
5. Service-role key verifiably absent from the client bundle (grep the build output).
   Report anything stubbed, honestly labeled.

> Before you STOP and report, in this exact order — never STOP dirty:
> 1. `git add -A && git commit -m "<clear message>"` on your branch.
> 2. `git push -u origin <branch>` — if push fails, run `cg artifact <path>` as the fallback and note it.
> 3. Only now STOP and report: **branch**, **commit SHA** (`git rev-parse --short HEAD`), and
>    **push result** (pushed / failed: why / artifact-fallback). Don't merge.

Do not begin until I confirm.
