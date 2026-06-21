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
- **Command dispatch (authed control plane)**: an authed-only panel (between the
  header and the machine grid) to dispatch **allowlisted** commands to a machine
  and watch them run. `fleet_commands` is **deny-all** to anon/authenticated —
  only the service role, server-side, reads/writes it. Unauthed viewers see no
  dispatch UI and no history. See below.

## Command dispatch (control plane)
- `POST /api/command` — body `{ machine_id, verb, args }`. Re-verifies the auth
  cookie, validates `verb`+`args` against the **shared allowlist**
  (`lib/commands/allowlist.mjs`), and inserts a `pending` row into
  `fleet_commands` (service role) with `requested_by:"dashboard"`. Off-list verbs
  and malformed/hostile args are rejected with `400` — free-text commands are
  impossible.
- `GET /api/commands?machine_id=…&limit=…` — returns recent commands + their
  `status`/`result`/`exit_code` for the panel to **poll** (every 3s). Polling, not
  realtime: `fleet_commands` is intentionally not in the realtime publication and
  not anon-readable.
- Both routes are gated by `middleware.ts` **and** re-verify the cookie in-handler.

### Shared allowlist — single source of truth
`lib/commands/allowlist.mjs` is **plain ESM (`.mjs`, zero deps)** on purpose: the
Node control agent (P2-A `agent/allowlist.mjs`) imports the **byte-for-byte
identical** file the TypeScript dispatch route imports, so the UI and the agent can
never drift. Types for the route come from the sibling `allowlist.d.mts`. A parity
test (added at consolidation) asserts the two copies are equal. Verbs in this cut:
`check`, `status`, `fetch-log {name}`, `pull`, `artifact {relpath, dest?}`. Args
are whitelisted by name and a strict charset (no shell metacharacters, no `..`, no
absolute paths). **Never add a free-text / arbitrary-exec verb here.**

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
| `SUPABASE_SERVICE_ROLE_KEY` | **server-only** | Reads `fleet_job_links`; reads/writes `fleet_commands`. NEVER prefix with `NEXT_PUBLIC_`. |
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
