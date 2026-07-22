# MCv2 — M0: Auto-draft-PR completion hook (phone-native review, formalized gate)

> MISSION CONTROL v2, milestone M0. Read `ops/prompts/PROMPT_fleet_conventions.md` first, then
> `docs/V2_PLAN.md`. Branch: `feat/mcv2-hook-pr`. Scope: **`deploy/hooks/` + `docs/` +
> `.env.example` only** — no schema, no ingest/Edge Function code, no `web/`, no portfolio.
> The bus-side routing of the new `pr_url` field is the **sibling `schema` session**
> (`feat/mcv2-schema`); build to the contract below and coordinate on it — exactly the
> F2-a/F2-b split from Phase D.

## Goal
Extend the existing per-machine completion hook (`deploy/hooks/fleet-notify.sh`) so that when a
delegated Code session finishes on a pushed feature branch, **a draft PR already exists and the
phone push deep-links to it**. This formalizes the review gate ("nothing auto-ships" — the draft
PR *is* the gate) and makes review/merge phone-native immediately, before any cockpit UI exists.

On `SessionEnd`, after the existing push + bus behavior, additionally:
1. **Ensure a draft PR exists** for the session's branch (idempotent):
   - Determine repo + branch from `cwd` (already derived). Skip silently (log only) when: not a
     git repo; detached HEAD; branch == the repo's default branch; branch has no upstream /
     isn't pushed; `gh` missing or unauthed; repo has no GitHub remote.
   - If a PR (draft or open) already exists for the branch, **reuse its URL** — never create a
     duplicate. Discover via `gh pr view --json url` / `gh pr list --head <branch> --json url`.
   - Else `gh pr create --draft` against the default branch. Title: `<branch> — <project>`
     (or similar, concise). Body: the session's **final assistant message** (already extracted;
     cap length sanely), then a footer with the `/rc` URL if present, machine name, tmux/job
     name, and a `fleet-mission-control` marker line.
2. **Carry `pr_url` on the bus POST** — add `"pr_url": "<url>"` to the existing `jobs[]` entry
   (sensitive field, same tier as `rc_url`; the sibling `schema` session routes it to private
   storage. If ingest ignores it for now, that's fine — send it anyway and note it in your report).
3. **Deep-link the pushes** — the ntfy `Click:` header prefers the PR URL over the `/rc` URL when
   both exist; the push body gains a short "PR ready for review" line. Desktop banner unchanged
   apart from that line. The `Notification` ("needs you") path is untouched.

## Hard constraints
- **FAIL-SOFT REMAINS THE PRIME DIRECTIVE.** Every `gh` call time-boxed (reuse the curl
  max-time pattern; `gh` has no `--max-time` — wrap with `timeout` where available, guard where
  not) and its failure swallowed + logged. The hook must still always exit 0, never block a
  session, and must behave exactly as today when `gh` is absent.
- **The hook never pushes code.** Sessions own commit→push (conventions). Unpushed branch ⇒ no
  PR, log it — do not "helpfully" push.
- **No new secrets.** `gh` is already signed in on Mac and `sentry` (`vishal-h-pathak` — the
  same auth that makes box pushes work, see `docs/HOW_IT_WORKS.md`). Bus auth stays
  `FLEET_TOKEN`. Never commit tokens or a real ntfy topic (placeholder discipline: `e893c46`).
- Config additions (env, machine-level, gitignored): opt-out flag (e.g. `FLEET_PR_DISABLE=1`),
  PR body length cap (e.g. `FLEET_PR_BODY_MAXLEN`, default ~16000). Update
  `deploy/hooks/hook.env.example` + `.env.example` with placeholders and `deploy/hooks/README.md`
  + the relevant `docs/` (LOOP_CLOSER addendum) with the new behavior.
- Zero-dep discipline: bash + curl + jq + gh only.

## Acceptance (validate live on the Mac, then STOP and report)
1. A real finished Code session on a **pushed feature branch** → draft PR exists; body carries
   the final message + `/rc` footer; ntfy push arrives with `Click:` → the PR; bus POST body
   (show it) includes `pr_url`.
2. Re-firing the hook for the same branch (run the script by hand on the same stdin JSON) →
   **no duplicate PR**, same URL reused.
3. A session on `main`/default branch, and one with `gh` PATH-shadowed to a failing stub →
   session completes cleanly, no PR, soft log lines only.
4. `Notification` path demonstrably unchanged. Report which cases ran live on the Mac vs.
   reasoned-only for `sentry`, the exact `gh` commands used, and the final POST contract for
   the `schema` session.

> Before you STOP and report, in this exact order — never STOP dirty:
> 1. `git add -A && git commit -m "<clear message>"` on your branch.
> 2. `git push -u origin <branch>` — if push fails, run `cg artifact <path>` as the fallback and note it.
> 3. Only now STOP and report: **branch**, **commit SHA** (`git rev-parse --short HEAD`), and
>    **push result** (pushed / failed: why / artifact-fallback). Don't merge.

Do not begin until I confirm.
