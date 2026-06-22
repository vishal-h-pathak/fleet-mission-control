# F3 — Portfolio link to Fleet (P0)

Make Fleet Mission Control reachable from the portfolio site. Read
`~/dev/jarvis/fleet-mission-control/prompts/PROMPT_fleet_conventions.md` first.
Repo: `portfolio`. Branch: `feat/fleet-portfolio-link`.

## Goal
A visitor on `vishal.pa.thak.io` can get to the Fleet dashboard. Keep it small and clean;
do not pull Fleet's code into the portfolio — just link to it.

## Scope
- Add a **"Fleet"** (or "Mission Control") nav/menu entry that links to the Fleet app URL.
  Make the target configurable via env: `NEXT_PUBLIC_FLEET_URL` (default
  `https://fleet.vishal.pa.thak.io`). Update `.env.example`.
- **Optional, if low-risk:** add a `next.config` rewrite so `vishal.pa.thak.io/fleet`
  proxies to `NEXT_PUBLIC_FLEET_URL`. If rewrites would complicate the existing config or
  conflict with current routes, STOP and report instead of forcing it — the nav link alone
  satisfies P0.
- Match the portfolio's existing nav styling/placement; don't redesign navigation.

## Constraints
- Touch only what's needed for the link/rewrite. Don't modify dashboard or job-hunter code.
- Portfolio build must stay green.

## Acceptance (validate, then STOP and report)
1. `npm run build` (portfolio) is green.
2. The Fleet link is present in the nav and points at `NEXT_PUBLIC_FLEET_URL`.
3. If you added a rewrite, `/fleet` resolves to the Fleet app in `next dev`; otherwise report
   that you intentionally left it as a plain link and why.

Do not begin until I confirm.
