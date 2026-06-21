# Fleet Dashboard (`web/`)

Phone-responsive, realtime monitoring plane for Fleet Mission Control. Standalone
Next.js app — its own Vercel project at `fleet.vishal.pa.thak.io`.

- **Public plane** (anon key, read-only): machine cards from `fleet_machine_status`
  (online/stale/offline, CPU/RAM/GPU, uptime, last-seen) + active jobs grouped by
  machine with progress bar / latest fitness / ETA. Supabase **realtime** keeps it
  live; clean reconnect + live indicator.
- **Authed slice**: a shared password → signed, httpOnly cookie (`middleware.ts`
  gate). `GET /api/job/[id]/links` uses the **service-role** key to return
  `rc_url`/`rc_qr` from the private `fleet_job_links` table — only with a valid
  cookie. The public surface never contains `rc_url`.

## Stack
Next.js 16.2.3 (App Router) · React 19 · Tailwind 4 · `@supabase/supabase-js ^2.49` · TypeScript.

## Local development
```bash
cp .env.example .env.local   # then fill the secret values (see below)
npm install
npm run dev                  # http://localhost:3000
npm run build && npm start   # production build / serve
```

## Environment variables
| Var | Scope | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | public | Project URL. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public | Publishable key; read-only by RLS. |
| `SUPABASE_SERVICE_ROLE_KEY` | **server-only** | Reads `fleet_job_links`. NEVER prefix with `NEXT_PUBLIC_`. |
| `FLEET_DASH_PASSWORD` | server-only | Shared dashboard password. |
| `FLEET_AUTH_SECRET` | server-only | Long random hex; signs the auth cookie. |

Only the two `NEXT_PUBLIC_*` vars are ever sent to the browser. The service-role
client is guarded by `import "server-only"` so a build fails if it leaks into client code.

> **`.env.local` gotcha:** Next loads `.env.local` through dotenv-expand, which treats
> `$` as a variable reference. If a secret contains `$`, escape each one as `\$` in
> `.env.local` (e.g. `pa$$w0rd` → `pa\$\$w0rd`). **In the Vercel dashboard, do NOT
> escape** — values there are stored literally; enter the real `pa$$w0rd`.

## Deploy to Vercel
1. New Vercel project → **Root Directory: `web/`** (framework auto-detected as Next.js).
2. Add the 5 env vars above (Production + Preview). Enter secret values **literally**
   (no `\$` escaping in the Vercel UI).
3. Assign domain `fleet.vishal.pa.thak.io`.
4. Deploy. The portfolio links to this URL (work package F3).

In production the auth cookie is issued `Secure` (HTTPS-only), `HttpOnly`, `SameSite=Lax`.

## Realtime
Subscribes to `fleet_heartbeats`, `fleet_jobs`, `fleet_machines` (the
`fleet_machine_status` view is re-queried on change, since views aren't in the
realtime publication). A 20s safety re-fetch covers any missed event, and machine
status decays (online → stale → offline) on a 1s client tick.
