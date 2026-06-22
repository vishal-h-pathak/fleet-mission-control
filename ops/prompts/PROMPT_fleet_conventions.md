# Fleet Mission Control — shared conventions (read before any P0 task)

You are implementing one work package of **Fleet Mission Control**. Read this first, then
your task prompt. Do not begin implementing until the human confirms.

## Orient
Read, in order: `ONBOARDING.md`, `docs/BRIEF.md`, `docs/SCHEMA.md`, `docs/P0_PLAN.md`.
(If you are in the portfolio repo, these live at `~/dev/jarvis/fleet-mission-control/`.)
The two-layer model matters: Anthropic's `/remote-control` (`/rc`) is the depth layer — do
NOT rebuild live agent-steering. We build the breadth layer: push telemetry → Supabase →
dashboard, joined by surfacing each job's `/rc` URL.

## The data layer is LIVE and FROZEN for P0 — do not change it
- Supabase project `sbmsxerwgylpfkkkjtku` (shared with the portfolio), tables `fleet_*`.
- The ingest contract is `schema_version: 1` (see `docs/SCHEMA.md`). Build to it exactly.
- If you believe a schema change is needed, **STOP and report** — do not run migrations,
  do not alter tables, do not touch the `ingest` function. Schema is owned by the planner.

## Security — non-negotiable (this is a public-shell + authed-controls system)
- The **public** surface (`fleet_machines`, `fleet_heartbeats`, `fleet_jobs`,
  `fleet_machine_status`) is read with the **anon/publishable** key only.
- `rc_url`, `rc_qr`, full `cmd`, `metrics_url`, `log_tail`, and per-machine tokens are
  **SENSITIVE**. They live in private tables (`fleet_job_links`, `fleet_machine_secrets`)
  and may ONLY be read server-side with the **service-role** key behind auth. NEVER ship
  any of them to the public client or embed them in public HTML/JSON.
- The service-role key is server-only. Never import it into client code or `NEXT_PUBLIC_*`.
- Reporters authenticate with a per-machine bearer token from env (`FLEET_TOKEN`); never
  hardcode tokens; never commit `.env`.

## Workflow
- Work ONLY on your assigned branch and within your work package's folder. Don't edit other
  packages' files.
- **Validation-first.** Build it, typecheck/lint, run the smoke test specified in your task,
  then **stop and report** what works vs. what's stubbed before declaring done. Radical
  honesty: label stubs as stubs.
- Commit on your branch when the human approves; write a clear message. Don't merge.
- **Commit → push → STOP, in that order.** A delegated or STOP-gated session must, *before* it
  STOPs and reports, do these in order: (a) stage + commit its work on its branch with a clear
  message; (b) `git push` that branch to `origin` (creds permitting — if push fails, say so and
  fall back to `cg artifact`, never silently drop it); (c) *only then* STOP. Never STOP with
  uncommitted or unpushed work — that strands the artifacts and they have to be ferried by hand.
  "Report" must include the **branch name**, the **commit SHA**, and the **push result** (pushed /
  failed-why / artifact-fallback). The "don't merge" rule still holds — commit and push your
  branch, never merge it.
- Keep `.env.example` updated if you add config; never commit real secrets.
- Match the portfolio stack for any web code: Next.js 16.2.3, React 19, Tailwind 4,
  `@supabase/supabase-js ^2.49`, TypeScript.

### STOP-gate block (reusable — paste verbatim into any STOP-gated task prompt)
> Before you STOP and report, in this exact order — never STOP dirty:
> 1. `git add -A && git commit -m "<clear message>"` on your branch.
> 2. `git push -u origin <branch>` — if push fails, run `cg artifact <path>` as the fallback and note it.
> 3. Only now STOP and report: **branch**, **commit SHA** (`git rev-parse --short HEAD`), and
>    **push result** (pushed / failed: why / artifact-fallback). Don't merge.

## Reference values (non-secret)
- Project URL: `https://sbmsxerwgylpfkkkjtku.supabase.co`
- Ingest: `POST https://sbmsxerwgylpfkkkjtku.supabase.co/functions/v1/ingest`
- Publishable (anon) key + URL are in `.env.example`. The service-role key and machine
  tokens are NOT in the repo — get them from the human / Supabase dashboard.
