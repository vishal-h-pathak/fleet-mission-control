# MCv2 — M4 chunk B: agent wave-launch loop (wave 3) — SECURITY-CRITICAL

> MISSION CONTROL v2, wave 3. Read `ops/prompts/PROMPT_fleet_conventions.md`, then
> `docs/V2_PLAN.md` and `docs/SCHEMA_V2.md` **including the new dispatch contract**
> (landed by the consolidated `wave-states` chunk — if the dispatch section is missing
> from your worktree's copy, STOP and say so). Branch: `feat/mcv2-agent-runwave`.
> Scope: `agent/`, `scripts/check-allowlist-parity.mjs`, `docs/`, `.env.example`.
> No `supabase/`, no `cockpit/`, no `deploy/hooks/`.
>
> This is the code that turns a web click into processes on this machine. Every rule
> in `agent/allowlist.mjs`'s existing regime applies with zero exceptions: hard-coded
> allowlists, charset-whitelisted everything, `spawn` with `shell:false`, no arbitrary
> shell, no secret beyond `FLEET_TOKEN`. When in doubt at ANY point, STOP and ask —
> a wrong guess here executes code.

## Goal
The agent (already a long-running service) gains a **wave-launch loop** beside its
command loop: poll the `dispatch` Edge Function → claim → validate → launch each of
this machine's sessions as a `cg runi` tmux session → ack. The bus is UNTRUSTED
input: everything it says is revalidated locally before use.

## Validation gauntlet (every session, before any process is spawned)
1. `repo` ∈ a **hard-coded fixed set** in `agent/allowlist.mjs` (start:
   `vishal-h-pathak/fleet-mission-control`, `vishal-h-pathak/portfolio`,
   `vishal-h-pathak/jobify`, `vishal-h-pathak/caddiehack`,
   `vishal-h-pathak/cellular-gaits`) mapped to their local checkout paths (env-driven
   per machine, e.g. `FLEET_REPO_ROOT=~/dev/jarvis`). Unknown repo ⇒ reject-ack.
2. `name`, `branch` match the existing charset validators (reuse, don't re-invent);
   `model` ∈ {`haiku`,`sonnet`,`opus`}; `prompt_ref` matches
   `^ops/prompts/PROMPT_[A-Za-z0-9_.-]{1,120}\.md$`.
3. **Committed-prompts-only, enforced at execution:** `git fetch origin` in the local
   checkout, then verify `prompt_ref` exists in `origin/main`
   (`git cat-file -e origin/main:<prompt_ref>`). Missing ⇒ reject-ack. This is the
   structural guarantee that only reviewed, versioned instructions can run.
4. The worktree path is COMPUTED BY THE AGENT (`<repos-root>/<repo-basename>-wt/<name>`),
   never taken from the payload. Registered `worktree`/`directive` fields are ignored
   for execution.
5. Every git/tmux/cockpit.sh invocation: argv arrays, `shell:false`, `--` guards
   where the tool supports them, timeouts, and reject-don't-retry on failure.

## Launch
- `git worktree add` on the validated branch (create from `origin/main` if new),
  then launch via the existing cockpit path: `~/dev/jarvis/portfolio/cockpit.sh`
  `cg runi`-style interactive session (tmux name = session `name`, `--model <model>`,
  `--rc`, bypassPermissions), seeding a directive the AGENT composes from a fixed
  template parameterized ONLY by validated fields:
  "Read ./ops/prompts/PROMPT_fleet_conventions.md then ./<prompt_ref> and implement it
  on this branch (<branch>). Validate, then STOP and report. Do not begin until the
  operator confirms." (Exact template in code, covered by a unit test — bus text never
  enters it.) Because these are tmux `runi` sessions, /rc URLs, hook reporting, and
  rung-2 name matching all work by construction.
- Claim → launch → ack per the contract; a failed launch acks the error and moves on;
  the loop must never crash the agent (fail-soft like everything else).
- Respect a concurrency cap (env, default 4) on simultaneous launches.

## Parity + tests
- Extend `scripts/check-allowlist-parity.mjs` to cover the new fixed repo set +
  validators so drift fails loudly, as with verbs.
- Unit-test the validation gauntlet (accept/reject table incl. path-traversal
  attempts in prompt_ref like `../`, absolute paths, flag-injection strings as
  names/branches) and the directive template. Use the house zero-dep node test style.

## Acceptance (live on this Mac, then STOP and report)
1. All tests green; parity check green; shellcheck n/a (Node) — lint however the
   agent code is linted today.
2. **Live fire drill:** with the planner-applied schema + deployed `dispatch`
   function live, the planner will have confirmed a one-session self-test wave
   (`mcv2-w3-selftest`, prompt = an existing trivial committed prompt) — poll, claim,
   validate, launch it for real; show the tmux session exists, the directive is
   pasted-unsubmitted at a STOP gate, and the ack landed. Then kill the tmux session
   without submitting (no tokens burned beyond startup). If the planner hasn't staged
   this wave yet, STOP and request it rather than fabricating one.
3. Reject-path drill: a doctored poll response (test harness, not the live bus) with
   a non-allowlisted repo, a `../` prompt_ref, and a flag-injection branch name — all
   rejected with error acks, nothing spawned.
4. Report the full accept/reject table and every place bus data touches an argv.

> Before you STOP and report, in this exact order — never STOP dirty:
> 1. `git add -A && git commit -m "<clear message>"` on your branch.
> 2. `git push -u origin <branch>` — if push fails, note it and use `cg artifact`.
> 3. Only now STOP and report: **branch**, **commit SHA**, **push result**. Don't merge.

Do not begin until I confirm.
