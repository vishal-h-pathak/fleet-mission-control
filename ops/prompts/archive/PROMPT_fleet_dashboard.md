# F2 — Dashboard (P0)

Build the **phone-responsive, realtime monitoring dashboard**. Read
`prompts/PROMPT_fleet_conventions.md` first. Branch: `feat/fleet-p0-dashboard`. Folder: `web/`.

## Goal
A standalone Next.js app that shows, live, every machine in the fleet and what's running on
it — the read-only monitoring plane. Deployable to its own Vercel project
(`fleet.vishal.pa.thak.io`). Public shell + an authed slice for sensitive links.

## Stack
Next.js 16.2.3 (App Router), React 19, Tailwind 4, `@supabase/supabase-js ^2.49`,
TypeScript. Mirror the portfolio's conventions where reasonable.

## Public monitoring plane (anon/publishable key, read-only)
- **Machine cards** from `fleet_machine_status`: name, kind, derived `status`
  (online/stale/offline with a clear color), CPU %, RAM used/total, GPU (util/mem/temp if
  present), last-seen relative time, uptime.
- **Active jobs**: from `fleet_jobs` where `status='running'` (plus recently ended), grouped
  by machine: name, project, kind, status, and `progress` (gens done/total, best fitness,
  ETA) — render a small progress bar / latest-fitness number when present.
- **Realtime**: subscribe to `fleet_machines`, `fleet_heartbeats`, `fleet_jobs` via Supabase
  realtime; update cards without a refresh. Reconnect cleanly; show a "live/stale" indicator.
- **Phone-first**: must look right at 390px (single-column cards, tap targets); scale up to a
  multi-column grid on desktop. Verify the mobile layout explicitly.
- The public client uses ONLY `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
  It must never read `fleet_job_links` / `fleet_machine_secrets` (RLS blocks it anyway).

## Authed slice — "authed controls" boundary (P0 = reveal `/rc` links only)
- Minimal auth: a shared password (`FLEET_DASH_PASSWORD`) exchanged for a signed,
  httpOnly cookie; `middleware.ts` gates the authed routes. (Mirror the portfolio's
  `dashboard_auth` cookie approach; keep it self-contained — do not depend on the portfolio.)
- A **server-only** route `GET /api/job/[id]/links` uses the **service-role** key to return
  `fleet_job_links` (`rc_url`, `rc_qr`) for that job — ONLY with a valid auth cookie.
- In the UI, a job's "Open in remote control" affordance calls this route; when unauthed it
  shows a sign-in prompt instead of the URL. The public page must never contain `rc_url`.

## Config
`.env.example` (web): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (provided),
`SUPABASE_SERVICE_ROLE_KEY` (server-only), `FLEET_DASH_PASSWORD`, `FLEET_AUTH_SECRET`
(cookie signing). Add Vercel project config/notes.

A gitignored `./.fleet-secrets.env` (copied into this worktree by the launcher) holds the
project URL + anon key (non-secret, ready to use). The `SUPABASE_SERVICE_ROLE_KEY`,
`FLEET_DASH_PASSWORD`, and `FLEET_AUTH_SECRET` are blank there — ask the human for the
service-role key (Supabase > Project Settings > API) and let them choose the password/secret.
Put real values only in a gitignored `web/.env.local`, never in `.env.example`.

## Acceptance (validate, then STOP and report)
1. `npm run build` is green (no type errors).
2. With seeded/live rows, machine cards and active jobs render; a new heartbeat/job updates
   the UI live via realtime (test by inserting a row or running the reporter).
3. Mobile layout verified at 390px (describe how you checked).
4. `GET /api/job/<id>/links` returns 401 without the cookie and the `rc_url` with it; the
   public page's HTML/JSON never contains `rc_url`. Confirm explicitly.
5. Vercel deploy config ready. Report what's real vs. stubbed before finalizing.

Do not begin until I confirm.
