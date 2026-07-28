# MCv2 — Cockpit guide page (`/guide`): what this is, how it works, how to fly it

> Read `ops/prompts/PROMPT_fleet_conventions.md` first, then `docs/V2_PLAN.md` and
> `docs/SCHEMA_V2.md` (the M4 dispatch section especially — you are documenting it).
> Scope: **`cockpit/` only** (+ a nav link). No schema, no agent/, no deploy/, no web/.

## Goal
A `/guide` page inside the cockpit: a tutorial + how-it-works that lets anyone remotely
technical understand, in one sitting, what Mission Control is, why it exists, and how to
run a wave end to end. Easy to follow, pleasing to look at, honest about how it works.
Authed like every other route; add "Guide" to the nav alongside Inbox / Waves / Compose.

## Content (this outline is the contract; write the prose yourself, well)
1. **What this is & why** (3–4 short paragraphs): a cockpit for operating a fleet of AI
   coding sessions from anywhere. The problem it solves: the delegation lifecycle
   (plan → dispatch → watch → review → merge) used to be scattered across terminals,
   chat threads, push notifications, and a laptop-bound launcher; the operator's mental
   model is work-centric (project → wave → session → decision) while the machines are
   machine-centric. Mission Control is the index + decision surface over both. Be
   concrete about what it is NOT: diffs live on GitHub (draft PRs are the review gate),
   live steering lives in Claude Code's /rc, planning lives in the operator's Cowork
   sessions — this app deliberately rebuilds none of those.
2. **The objects** — Project, Wave, Session, Decision — one tight paragraph each, with
   the session status vocabulary (planned / running / waiting / done / reviewed /
   merged / rejected / lost) rendered as the same status chips the app uses (import the
   shared STATUS_STYLE — do not fork a second color map).
3. **The four screens** — Inbox (what needs you: review + approve/redispatch/reject/
   dismiss), Waves (what the fleet is doing, live), Compose (build + confirm a wave),
   Guide (this). One paragraph + one representative visual each. For visuals prefer
   stylized CSS/SVG mockups of the real components over screenshots (no binary assets,
   stays current with the theme).
4. **Anatomy of a dispatch** — the centerpiece: a step-by-step visual walkthrough
   (numbered vertical timeline or SVG flow, pure CSS/SVG, no chart libs) of what
   actually happens when you press Confirm: wave `confirmed` (audited: who + when) →
   the target machine's agent polls and claims it (race-safe, per-machine) → the agent
   revalidates EVERYTHING against its own hard-coded allowlist (fixed repo set, the
   prompt must exist committed on origin/main, charset checks, agent-computed paths) →
   tmux session launches with the directive and an /rc link → the session works and
   STOPs → on exit, the completion hook pushes a notification, opens a draft PR, and
   writes the summary to the bus → the session lands in your Inbox for a decision.
   Thread the safety story through it rather than as a separate lecture: only committed
   prompts can run; free-text on the bus is never executed; `confirmed` can only be set
   by a signed-in allowlisted operator; nothing ever merges itself.
5. **Your first wave** — a 6–8 step hands-on: what you need (a prompt file merged to
   main), then Compose → pick project → pick prompt → machine/model/branch → preview →
   type the wave name to arm Confirm → watch /waves → get the push → review the PR →
   decide in Inbox. Include the current honest caveats as a styled note: dispatch
   targets machines whose agent is running; a session killed abruptly reports nothing
   (the 30-minute sweeper marks it `lost`); merging happens on GitHub.
6. **Status & term glossary** — compact two-column reference: every session status,
   wave lifecycle status, and the terms wave/claim/dispatch/rc/draft-PR/dismiss.

## Style
- Match the cockpit exactly: same dark palette, typography, spacing idioms as the
  existing screens; prose-first with generous whitespace; sparing bold; mobile-first
  responsive. No new dependencies, no images, no lorem. Long-form reading should feel
  calm — think well-set documentation, not marketing.
- All content static/server-rendered; no data fetching needed. Accurate to the code as
  merged on main TODAY — where this outline and the code disagree, the code wins; note
  any such divergence in your report.

## Acceptance (then STOP and report)
1. Build + typecheck + existing tests green; `/guide` gated by auth like every route;
   nav link present on all screens.
2. Every status chip on the page renders from the shared STATUS_STYLE map (grep proof).
3. Mobile (390px) + desktop screenshots of the full page.
4. A non-expert read-through pass: no unexplained jargon — every term used is defined
   on the page by first use or in the glossary.

> Before you STOP and report, in this exact order — never STOP dirty:
> 1. `git add -A && git commit -m "<clear message>"` on your branch.
> 2. `git push -u origin <branch>` — if push fails, note it and use `cg artifact`.
> 3. Only now STOP and report: **branch**, **commit SHA**, **push result**. Don't merge.
