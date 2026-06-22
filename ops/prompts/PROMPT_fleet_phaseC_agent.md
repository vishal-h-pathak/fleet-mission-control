# Phase C-A — Agent: new verbs (morning / nav / run) + approval enforcement + safe directive plumbing

> PHASE C. The `fleet_commands` schema now has `awaiting_approval` status + `approved_by`/`approved_at`,
> and the `commands` Edge Function's claim returns `approved_at`. Read
> `prompts/PROMPT_fleet_conventions.md` first. Branch: `feat/fleet-phaseC-agent`.
> Touches: `agent/` (fleet repo) AND `~/dev/jarvis/portfolio/cockpit.sh` (separate repo — commit it
> there separately, it's a plain script, no secrets).

## Goal
Extend the control plane from read-only verbs to **guarded action verbs**, keeping the hard security
properties: no shell-from-web, allowlist-only, strict validation, and powerful verbs gated by an
explicit approval. Richness comes from delegating a *goal* to Claude on the box — never a shell string.

## New verbs (add to agent/allowlist.mjs — the DASHBOARD copy must match byte-for-byte; parity test guards it)
Add a per-verb `requiresApproval` flag. Existing verbs (check/status/fetch-log/pull/artifact) →
`requiresApproval: false`. New:
- **`morning`** — no args, `requiresApproval:false` → `cockpit.sh morning` (resync: fetch sentry logs +
  git-pull both Mac repos + status). This is the cellular-gaits resume trigger.
- **`nav`** — no args, `requiresApproval:true` → `cockpit.sh nav` (start the paused navigation run).
- **`run`** — `requiresApproval:true`, args `{ repo, directive }`:
  - `repo` MUST be one of a FIXED set: `cellular-gaits`, `portfolio`. Reject anything else.
  - `directive` is a natural-language string: length-capped (e.g. ≤2000 chars), reject control chars /
    newlines. It does NOT need a restrictive charset because it will be passed **base64-encoded** (see
    below) — but still cap length and strip NULs/control chars.
  - Maps to a NEW `cockpit.sh run-b64 <repo> <base64-directive>` (you add this to cockpit.sh) so the
    directive crosses ssh/tmux with ZERO quoting/injection surface.

## cockpit.sh change (in ~/dev/jarvis/portfolio/cockpit.sh)
Add a `run-b64 <repo> <b64>` subcommand: base64-decode the directive on the box, then launch the
delegated session **with Remote Control on** so it self-surfaces:
`claude --rc --permission-mode bypassPermissions -p "<decoded directive>"`, tee'd to
`$RLOG/<sess>.log` in tmux (same pattern as the existing `run`). Because of Phase B, the `/rc` URL it
prints lands in the log → the reporter scrapes it → the dashboard surfaces it → tap to steer. Keep the
existing `run` untouched for backward compat. Decode safely (`base64 -d`), never `eval`.

## Approval enforcement (defense-in-depth in the agent)
The agent only ever claims `status='pending'` (it never sees `awaiting_approval`). Additionally: when a
claimed command's verb has `requiresApproval:true`, **refuse to execute it unless the claimed row has a
non-null `approved_at`** → set `status:"rejected"`, reason "unapproved". (Belt-and-suspenders: even if a
mutating verb somehow reached `pending` without approval, the agent won't run it.) Validate every verb
through the shared allowlist before executing, as today. Keep `spawnSync` `shell:false`.

## Acceptance (validate, then STOP and report)
1. Allowlist self-test still passes; add cases for the new verbs + `run` arg validation (bad repo,
   over-long directive, control chars → rejected; valid → ok). Parity with the dashboard copy stays exact.
2. `--simulate run '{"repo":"cellular-gaits","directive":"echo hi"}'` (offline) shows the resolved
   `cockpit.sh run-b64 cellular-gaits <b64>` argv WITHOUT executing; bad inputs rejected.
3. Approval enforcement: a claimed `run`/`nav` row with `approved_at=null` is rejected, not executed
   (demonstrate via a simulated claim payload).
4. `cockpit.sh run-b64` round-trips a directive containing quotes/spaces/punctuation correctly (decode
   test). No new npm deps in the agent. Report what's live-tested vs. deferred to the post-merge run.

Do not begin until I confirm.
