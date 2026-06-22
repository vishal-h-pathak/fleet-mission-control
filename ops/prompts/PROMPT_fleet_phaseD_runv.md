# Phase D — `run-v` / `peekv` streaming dispatch (validate the draft, then commit)

> PHASE D, feature F3. Read `ops/prompts/PROMPT_fleet_conventions.md` first. Branch:
> `feat/fleet-phaseD-runv`. This works in `~/dev/jarvis/portfolio` (separate repo — commit there).
> `run-v` (verbose `stream-json` dispatch) + `ops/render-stream.py` (Mac-side live renderer) are
> **already drafted but uncommitted and untested**. This session validates them against the live
> `sentry` box, fixes what's broken, and commits. It is the **observe-only sibling of `cg runi`**
> (next session) and proves the `stream-json` + tmux plumbing `runi` reuses — so do it first.

## Orient (read the existing draft before changing anything)
- In `~/dev/jarvis/portfolio`: read the uncommitted `run-v` / `peekv` additions in `cockpit.sh` and
  `ops/render-stream.py`. Summarize what they currently do, how the box is invoked
  (`claude ... --output-format stream-json --verbose -p ...` in tmux + tee), how the stream reaches
  the Mac (tee'd log + `peekv` tail? ssh pipe?), and how `render-stream.py` parses it.
- Note any gap vs. the existing `run` / `run-b64` verbs (directive seeding, log path, session naming).

## Goal
A `cg run-v <repo> "<directive>"` that dispatches a delegated session emitting `stream-json`, and a
`cg peekv <name>` (+ `render-stream.py`) that renders the live play-by-play on the Mac. Observe-only:
no steering, no STOP gate (that's `runi`). Reuse `run-b64`'s base64 directive seeding so quoting is
never a problem.

## Validate against the live box (this is the point of the session)
1. Dispatch a short real `run-v` to `sentry` (a trivial directive). Confirm the box launches `claude`
   with `stream-json` + `--verbose`, tmux session created, log tee'd.
2. `cg peekv <name>` renders the stream on the Mac — events parse, no crashes on partial/!JSON lines,
   clean EOF when the session ends. Fix `render-stream.py` parsing for any event types it mishandles.
3. Confirm the reporter still classifies the session as a `claude-session` job and (Phase B) still
   scrapes its `/rc` URL — `run-v` must not regress the existing telemetry/`/rc` path.
4. Keep it argv-array, `shell:false`-compatible, base64 directive, no `eval`. `render-stream.py`:
   stdlib only if practical; if a dep is needed, note it.

## Acceptance (validate, then STOP and report)
1. A live `run-v` → `peekv` round-trip on `sentry` renders readable play-by-play; report the exact
   command you ran and paste a short sample of rendered output.
2. `render-stream.py` handles the real `stream-json` event shapes (list which) without crashing on
   non-JSON / partial lines.
3. No regression: the session still appears as a job with its `/rc` URL surfaced (Phase B intact).
4. Commit `cockpit.sh` + `ops/render-stream.py` in `~/dev/jarvis/portfolio` on a clear message; report
   the SHA. Note anything left stubbed and what `runi` can reuse from this (seeding, log path, naming).

Do not begin until I confirm.
