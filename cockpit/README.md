# MCv2 Cockpit (`cockpit/`)

Authed-only operator cockpit for Mission Control v2. Reads the work-centric
Supabase schema (`fleet_projects` / `fleet_waves` / `fleet_sessions` /
`fleet_decisions`) and lets the operator review/approve/reject Claude Code
sessions from their phone.

**This task (M2 Task 1) is scaffold + auth only.** There is no real data yet
— `/` is a placeholder ("Inbox coming next"); Task 2 builds the actual inbox
UI and data layer on top of this auth wrapper, and Task 3 does live
validation against the real database once real credentials exist.

## Auth model
Real Supabase Auth (magic link / OTP), not a shared password:
- `/login` — email in, `signInWithOtp` sends a magic link
  (`lib/supabase/client.ts`, anon key only).
- `/auth/callback` — completes the PKCE/magic-link exchange
  (`exchangeCodeForSession`) and establishes the session cookie
  (`lib/supabase/server.ts`).
- `middleware.ts` — runs on every route except `/login` and `/auth/callback`:
  - no session → redirect to `/login`.
  - session, but the signed-in email is not in `COCKPIT_ALLOWED_EMAILS` →
    sign out and redirect to `/login?denied=1`.
  - otherwise → allow through (and refresh the session cookie).
- `lib/auth/allowlist.mjs` — the pure, framework-free email-compare function
  middleware.ts uses (comma-separated / trimmed / case-insensitive / exact
  match only, fail-closed). Self-test: `npm test` (or
  `node lib/auth/allowlist.test.mjs`).

## Supabase clients — two privilege levels
- `lib/supabase/client.ts` — browser client, **anon key only**, used ONLY for
  the auth flow (`signInWithOtp`, sign-out) from client components.
- `lib/supabase/server.ts` — server-side **anon key** client bound to
  request/response cookies, for Server Components / Route Handlers that need
  to read the caller's own session (the `/auth/callback` exchange, reading
  `user.email` on `/`). Same privilege as the browser client.
- `lib/supabase/admin.ts` — **service-role** client, guarded by
  `import "server-only"` (the build fails if it's ever pulled into client
  code). Import it ONLY from Server Components / Route Handlers that need
  privileged reads/writes — this is what Task 2's data layer will use to
  read `fleet_projects/waves/sessions/decisions` and write decisions. Never
  import it from middleware.ts or any `"use client"` module.

## Stack
Next.js 16.2.3 (App Router) · React 19.2.0 · Tailwind 4 ·
`@supabase/supabase-js ^2.49.0` + `@supabase/ssr ^0.12.3` · TypeScript ^5.7.0.

`@supabase/ssr` is the one dependency this app has beyond what `web/`
declares — it's what makes the Supabase session available as an httpOnly
cookie so `middleware.ts` (edge) and Server Components can read the same
session that the browser client established, which the real Supabase Auth
magic-link flow here needs and `web/`'s shared-password cookie scheme did not.

## Local development
```bash
cp .env.example .env.local   # then fill in the real values (see below)
npm install
npm run dev                  # http://localhost:3000
npm run build && npm start   # production build / serve
npm test                     # allowlist self-test (offline, no Supabase needed)
```

## Environment variables
| Var | Scope | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | public | Same Supabase project as `web/`. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public | Publishable key; used for the auth flow and reading the caller's own session. |
| `SUPABASE_SERVICE_ROLE_KEY` | **server-only** | Privileged reads/writes for Task 2's data layer. NEVER prefix with `NEXT_PUBLIC_`. |
| `COCKPIT_ALLOWED_EMAILS` | server-only | Comma-separated allowlist middleware.ts checks against. |

Only the two `NEXT_PUBLIC_*` vars are ever sent to the browser.

## No Vercel project yet
This app has not been deployed. There is no Vercel project, no production
Supabase Auth redirect URL configured, and no real `SUPABASE_SERVICE_ROLE_KEY`
/ `COCKPIT_ALLOWED_EMAILS` in this worktree — those are being filled in by the
human separately and covered by Task 3's live validation, not this task. Until
then this app has only been verified locally: `npm run build` + typecheck
clean, and `/login` renders. The magic-link round trip and the middleware's
allow/deny paths against a real session are NOT yet verified end-to-end.
