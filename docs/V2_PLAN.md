# Mission Control v2 — build plan (Direction 3: clean-slate cockpit)

> Status: **plan of record, 2026-07-22.** Supersedes nothing — extends the shipped P0–P3 +
> Phase A–D system. Design rationale lives in the Direction 3 brainstorm summary; this doc
> is the executable plan. Companion decision record:
> `~/dev/jarvis/memory/decisions/2026-07-22-mission-control-v2.md`.

## 1. Framing

The delegation lifecycle (plan → dispatch → watch → review → merge) is fragmented across
Cowork chat, Code terminals, the fleet dashboard, portfolio `/console`, ntfy, and raw
Supabase reads. Root cause: the operator's mental model is **work-centric**
(project → wave → session → diff → decision) but the bus + dashboard are
**machine-centric** (machines → jobs → telemetry). Review — the bottleneck — has no
surface at all; dispatch is Mac-bound by construction (`ops/waves/setup-*.sh`).

**v2 = a new authed-only operator app (`cockpit/`) that owns the full lifecycle**, as an
index + decision surface over existing primitives. The existing `web/` dashboard is
eventually demoted to a public portfolio showcase, ending the dual
public-showcase/private-cockpit mandate.

### Kept, not rebuilt
Supabase bus + Edge Functions · per-machine reporter/agent · SessionEnd/Notification hook
· `cockpit.sh` (`run`/`runi`/`run-v`) · `/rc` for live steering · ntfy push · Tailscale /
no-inbound-ports · **diff review via GitHub PR/compare** (mobile-friendly already) ·
**planning stays in Cowork**. Nothing here is greenfield except the web layer + schema.

### Placement (decided 2026-07-22)
- **`cockpit/` — fresh Next.js app in this repo**, own Vercel project, authed-only from
  day 1. Shares `supabase/`, `agent/`, `deploy/` with the rest of the repo.
- `web/` keeps running untouched until M5, then becomes the public showcase.
- Same Supabase project `sbmsxerwgylpfkkkjtku` (org at 2-project cap); new tables
  `fleet_`-prefixed, **private by default** (RLS deny-all, service-role only — the cockpit
  reads through authed server routes, never the anon key).

## 2. Core objects (schema v2)

Work-centric spine, joined to the existing machine-centric tables (which stay untouched):

- **`fleet_projects`** — registry: name, repo slug (`owner/name`), default branch, active.
- **`fleet_waves`** — a dispatched set of prompts: project, name, status, dispatched_at,
  notes. Registered by the launcher at dispatch time.
- **`fleet_sessions`** — a Code run as a *work item*: wave (nullable → "ungrouped"
  fallback), machine, optional link to `fleet_jobs` row, repo, branch, worktree, prompt
  ref, model, status (`planned → running → waiting → done → reviewed → merged | rejected`),
  last_message, rc_url, **pr_url**, timestamps.
- **`fleet_decisions`** — append-only: session, action
  (`approve_merge | redispatch_with_feedback | reject`), feedback text, decided_at.
- **Diff** is not a table — it's the GitHub PR/compare URL on the session.

Lifecycle writes: launcher registers wave + planned sessions → reporter/ingest flips
running → completion hook enriches (last_message, rc_url, pr_url, done) → operator
decisions recorded from the cockpit. Sessions dispatched outside a launcher land in the
ungrouped bucket via hook-driven upsert (matched on machine + tmux/job name, else created).

## 3. Milestone ladder

| M | What | Where | Status |
|---|---|---|---|
| **M0** | **Auto-PR completion hook** — hook creates a draft PR (body = final message + /rc link), writes `pr_url` to the bus, ntfy push deep-links to the PR. Cheapest, highest-leverage; do first regardless. | `deploy/hooks/`, tiny `pr_url` migration, ingest | wave 1 |
| **M1** | **Schema v2 + wave registration** — the four tables above, ingest v5 session matching/enrichment, `ops/bin/fleet-register-wave.mjs` for launchers. | `supabase/`, `ops/bin/` | wave 1 |
| **M2** | **Inbox** (cockpit default screen) — needs-you / done-awaiting-review (summary + open-PR + open-/rc) / recently merged. Read + deep-link first; decision writes included, merge button deferred to M4's verbs. | new `cockpit/` | wave 1 |
| **M3** | **Waves board** — sessions grouped project → wave, live status, tail streaming (run-v path), /rc deep links. | `cockpit/` | wave 2 |
| **M4** | **Compose + `run-wave` (+ `merge`) bus verbs** — pick project → committed prompts (`ops/prompts/`) → machine + model per chunk → preview → confirm → dispatch (agent launches tmux `runi` sessions). Most security-sensitive: strict arg validation, fixed repo set, confirm-preview replaces the pasted-unsubmitted gate. Phone-operable dispatch. | `agent/`, `supabase/functions/commands`, `cockpit/` | wave 3 |
| **M5** | **Showcase demotion** — `web/` → public portfolio piece (sparklines, machine cards, anon); kill the redundant portfolio `/console` Fleet tab + second auth. | `web/`, portfolio repo | wave 3/4 |

Alongside (not blocking): shrink `SYNC.md` back to narrative/handoff once sessions are bus
objects; Cowork-reads-Supabase stays planning-context-only; no new read-only command verbs
— the queue's next verbs are `run-wave` and `merge` only.

## 4. Wave 1 (this wave) — 3 sessions, 2 stages

Launcher: `ops/waves/setup-mcv2-wave1.sh` (stages `batch`, then `inbox`).

| Chunk | Branch | Model | Prompt |
|---|---|---|---|
| **hook-pr** (M0) | `feat/mcv2-hook-pr` | **sonnet** | `ops/prompts/PROMPT_mcv2_hook_pr.md` |
| **schema** (M1) | `feat/mcv2-schema` | **opus** | `ops/prompts/PROMPT_mcv2_schema.md` |
| **inbox** (M2, after schema applied) | `feat/mcv2-inbox` | **sonnet** | `ops/prompts/PROMPT_mcv2_inbox.md` |

Order: `batch` (hook-pr ∥ schema, independent files) → review; **planner applies proposed
migrations** (schema stays planner-owned per conventions) → `inbox` → review → merge wave.
Model rationale: hook-pr is careful-but-standard shell/ingest work (sonnet); schema is
cross-cutting design with idempotency subtleties (opus); inbox is feature work on a fresh
scaffold against a settled schema (sonnet).

## 5. Security invariants (v2 additions)

- All new `fleet_` v2 tables: RLS enabled, **zero policies** (deny-all); reads/writes only
  via service-role in authed cockpit server routes and Edge Functions. Nothing new joins
  the public/anon surface or the realtime publication.
- `pr_url` is private (`fleet_job_links` / `fleet_sessions`), like `rc_url` — a draft-PR
  URL leaks repo + branch + content.
- Cockpit auth: Supabase Auth, allowlisted owner email (same pattern as portfolio
  `/console`); middleware-gated, no public routes.
- The hook stays **fail-soft** (never blocks a session; every call time-boxed, exit 0) and
  gains no new secrets — `gh` CLI auth is already on each box; the bus write still uses
  `FLEET_TOKEN` only.
- `run-wave` (M4, not this wave): allowlisted verb, charset-whitelisted args, fixed repo
  set, `shell:false` — same regime as `agent/allowlist.mjs`; the cockpit confirm-preview
  is the human gate. Nothing auto-ships: the draft PR **is** the review gate, formalized.

## 6. Review gates per session (unchanged conventions)

Every session: worktree + own branch, validation-first, **commit → push → STOP** with
branch/SHA/push-result, never merge, schema changes PROPOSED not applied
(`ops/prompts/PROMPT_fleet_conventions.md`). Consolidation via
`ops/prompts/PROMPT_fleet_consolidate.md` after each stage.
