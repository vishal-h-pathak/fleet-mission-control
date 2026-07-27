# Fleet Mission Control — Control agent (P2-A)

A per-machine agent that turns **allowlisted** commands from the bus into real work via
`cockpit.sh`, and reports results back. This is the **security-critical** surface of the fleet:
a hard-coded verb allowlist, charset-whitelisted args, `spawn` with `shell:false`, and **no
arbitrary shell** — ever. Zero npm deps, Node 18+, ESM. Same style as the reporter (`../index.mjs`).

## How it talks to the bus (no service-role key on the machine)

The agent authenticates with its existing per-machine token (`FLEET_TOKEN`) against the
token-authed `commands` Edge Function. It never holds the service-role key; the Edge Function
is the only thing that touches the DB.

```
POST $FLEET_COMMANDS_URL   Authorization: Bearer $FLEET_TOKEN
  { "action": "claim" }                                  -> { "claimed": [ { id, verb, args, created_at } ] }
  { "action": "running", "id": "<cmd>" }                 -> marks it running
  { "action": "result",  "id": "<cmd>",
    "status": "done|error|rejected", "result"?, "exit_code"? }
```

The loop polls `claim` every `FLEET_POLL_INTERVAL_S` seconds (default 4). No realtime, no
service-role — atomic server-side claim means two agents never double-run the same command.

## Verb allowlist (hard-coded — `agent/allowlist.mjs`)

The allowlist is the **single source of truth** for what the control plane may do. Anything
off-list is rejected and **nothing executes**.

| verb        | args                       | runs                          |
|-------------|----------------------------|-------------------------------|
| `check`     | —                          | `cockpit.sh check`            |
| `status`    | —                          | `cockpit.sh status`           |
| `fetch-log` | `{ name }`                 | `cockpit.sh peek <name>`      |
| `pull`      | —                          | `cockpit.sh pull`             |
| `artifact`  | `{ relpath, dest? }`       | `cockpit.sh artifact <relpath> [dest]` |

> **Shared with the dashboard.** P2-B (`web/`) keeps a byte-identical copy at
> `web/lib/commands/allowlist.mjs` (the web app can't import outside its root on Vercel). A
> consolidation parity test fails if the two drift, so **the verb / arg / regex definitions
> here are authoritative** — change both together.

### Why it's safe

1. **Closed allowlist.** Unknown verb → `status:"rejected"`. There is no `run`/exec verb.
2. **Charset whitelist on args** (not a denylist):
   - `name` must match `^[A-Za-z0-9._-]{1,64}$`.
   - `relpath` / `dest` must be **clean relative paths**: no leading `/`, no `~`, no `..`,
     every segment `^[A-Za-z0-9._-]+$`. Unknown/extra arg keys are rejected.
3. **`spawnSync(COCKPIT_SH, argv, { shell: false })`** — args are passed as an **argv array**,
   never concatenated into a shell string, never built from free text. The agent's own shell
   never parses them.
4. **Defense in depth.** `cockpit.sh` itself interpolates `name`/`relpath` into *remote* `ssh`
   commands, so even though `shell:false` protects the agent host, the charset whitelist is
   what prevents downstream injection on the box.

See `agent/test.mjs` for 62 offline checks proving rejection of injection payloads
(`nav; rm -rf ~`, `$(reboot)`, `../../etc/passwd`, etc.).

## Execute + report

On a claimed command: validate → if rejected, report `rejected` (nothing runs) → else
`running` → run the mapped `cockpit.sh` invocation (capture stdout/stderr/exit code, truncated
to `FLEET_RESULT_MAXLEN`) → report `done` (exit 0) or `error` (non-zero) with `result` +
`exit_code`.

> Role split (per the brief): on the **Mac**, `cockpit.sh` drives `sentry`; the data-pull verbs
> (`pull`, `fetch-log`, `artifact`) belong to the **Mac** agent.

## Wave-launch loop (MCv2 M4 — `agent/launch.mjs`)

A **second loop**, beside the command loop, on its own interval and busy flag. It polls the
`dispatch` Edge Function for waves the operator has **confirmed** in the cockpit and launches
this machine's sessions as tmux `claude` sessions:

```
POST $FLEET_DISPATCH_URL   Authorization: Bearer $FLEET_TOKEN
  { "action": "poll" }                                    -> { work: [ { wave, session } ] }
  { "action": "claim", "session_id": "<uuid>" }           -> { won: true|false, reason? }
  { "action": "ack",   "session_id": "<uuid>",
    "ok": true|false, "error"? }                          -> { wave_status }
```

Order per session: **claim → validate → launch → ack**. The claim comes first because only the
machine holding it may ack — a rejection has to be claimed before it can be *recorded* as a
`launch_error`. A lost claim is a normal race outcome, not an error. A failed launch is acked
and terminal (the function never re-offers a session carrying `launch_error`); recovery is an
explicit operator re-dispatch, never an automatic retry. Nothing in the loop can throw into the
agent — telemetry and commands keep running whatever a wave does.

### The validation gauntlet — the bus is UNTRUSTED input

SCHEMA_V2 invariant (d): a compromised or merely buggy bus row must not be sufficient to run
code. Every field is revalidated locally against `agent/allowlist.mjs` before anything spawns:

1. **`repo` ∈ a hard-coded fixed set** (`LAUNCH_REPOS`) — `fleet-mission-control`, `portfolio`,
   `jobify`, `caddiehack`, `cellular-gaits` — each mapped to its **local checkout** and its
   **worktree root**. Both are hard-coded per repo rather than derived from the slug, because
   the real roots are irregular (fleet worktrees live in `fleet-wt/`). Unknown repo ⇒ reject-ack.
   The session's `repo` must also match the wave's project-registry entry.
2. **Charsets, reusing the existing validators**: `name` → `NAME_RE` plus no leading `-`/`.`
   (it becomes a tmux target *and* a path segment); `branch` → safe `/`-separated segments, no
   leading `-`, no `..`, no `.lock`, not `HEAD`; `model` ∈ {`haiku`,`sonnet`,`opus`};
   `prompt_ref` → `^ops/prompts/PROMPT_[A-Za-z0-9_.-]{1,120}\.md$` (`/` is outside the charset,
   so traversal is unrepresentable); `id` → uuid.
3. **Committed-prompts-only, enforced at execution**: `git fetch origin`, then
   `git cat-file -e origin/main:<prompt_ref>`. Missing ⇒ reject-ack. This is the structural
   guarantee that only reviewed, versioned instructions can run on this box.
4. **Paths are computed, never taken from the payload**: `<FLEET_REPO_ROOT>/<worktreeRoot>/<name>`.
   The row's own `worktree` and `directive` fields are record-only and are ignored for execution.
5. **Every invocation is an argv array with `shell:false`**, absolute binaries resolved from
   `PATH`, per-step timeouts, and reject-don't-retry on failure.

The directive is **composed locally** from a fixed template parameterized only by validated
fields — bus free text never enters it (invariant (c)), and the exact string is pinned by both
`agent/test-launch.mjs` and the parity check:

> Read ./ops/prompts/PROMPT_fleet_conventions.md then ./&lt;prompt_ref&gt; and implement it on this
> branch (&lt;branch&gt;). Validate, then STOP and report. Do not begin until the operator confirms.

### What a launch actually does

`git worktree add` (attach a local branch, track `origin/<branch>`, or create it from
`origin/main`) → `tmux new-session -d -s <name> -c <worktree> claude --model <model> --rc
--permission-mode bypassPermissions` → `tmux pipe-pane` into the cockpit log dir → wait for the
TUI to be **stable** → seed the directive with `send-keys -l` → confirm it landed → submit.
A failure after the session is created kills that tmux session, so a `launch_error` never leaves
a half-seeded TUI behind.

Three contracts are replicated deliberately (see "runi-local convergence" below):

- **tmux session name == the registered session name** — the completion hook's `JOB_NAME` is the
  tmux name, so ingest's rung-2 `(machine_id, name)` ladder binds the live process to its planned
  row by construction.
- **pane log → `$FLEET_COCKPIT_LOG_DIR/<name>.log`** — the same path the reporter tails for
  `log_tail` / progress / metrics.
- **`/rc` URL → `$FLEET_COCKPIT_LOG_DIR/<name>.rc`** — the Phase-B sidecar the reporter reads and
  routes to private `fleet_job_links.rc_url`. Written by a detached, fail-soft watcher.

**tmux is a prerequisite** (`brew install tmux` on the Mac). It is checked in the gauntlet: with
no tmux the session is reject-acked with a clear error and nothing else happens.

> **Two tmux target forms, and they are not interchangeable.** `has-session`/`kill-session` take
> a *session* target (`=<name>`); `capture-pane`/`send-keys`/`pipe-pane` take a *pane* target
> (`=<name>:`). The leading `=` forces exact-name matching — without it `w3` would resolve to a
> session called `w3-drill`. Using the session form on a pane command fails *silently* in a way
> that looks like something else entirely (no pane log is written; the readiness probe reads an
> empty string and the launch dies 40s later claiming the TUI never started). Both forms are
> pinned by `agent/test-launch.mjs` and executed for real against tmux by `agent/test-tmux-live.mjs`.
>
> **Seed confirmation is whitespace-normalized.** The input box soft-wraps and indents a long
> directive, and `capture-pane -J` does not rejoin those lines, so the raw tail never matches a
> correctly-pasted directive. Both sides are ANSI-stripped and whitespace-collapsed
> (`normalizePane`) before comparing; the check still requires the directive's *tail*, so a
> truncated paste is reported rather than submitted.

### Seed-and-submit vs paste-unsubmitted

The default is **seed AND submit**. The layering is deliberate: the *wave-level* human gate is
the cockpit's Confirm screen (which replaced the pasted-unsubmitted gate of the shell launchers),
and the *session-level* gate is the directive's own "Do not begin until the operator confirms"
STOP — steerable from a phone via `/rc`. A session that never starts reading its prompt isn't
safer, just stuck. Set `FLEET_LAUNCH_NO_SUBMIT=1` to paste the directive and stop there (used for
the acceptance drill, and for anyone who wants a keyboard gate on their machine).

### runi-local convergence (documented follow-up)

portfolio's `cg runi` verb does the same job for the **sentry box over ssh** — and it lives on the
unmerged portfolio branch `feat/dual-machine-watcher` (commit `6228b9a`); the `cockpit.sh` on disk
has no `runi` at all. It also hard-codes two repos, names sessions `claude-runi-<HHMMSS>`, takes no
`--model`, and creates no worktree, so it could not serve this loop. This wave therefore launches
locally and **does not touch the portfolio repo**. Follow-up: once that cockpit branch merges, add
a local `runi` path there and have the two converge on one launcher (same tmux-name / pane-log /
`.rc`-sidecar contracts, which is why they were replicated exactly rather than reinvented).

## Config (env)

| var | default | meaning |
|---|---|---|
| `FLEET_TOKEN` | *(required)* | per-machine bearer token; secret, never commit |
| `FLEET_COMMANDS_URL` | `…/functions/v1/commands` | the bus endpoint |
| `FLEET_POLL_INTERVAL_S` | `4` | claim poll interval |
| `COCKPIT_SH` | `~/dev/jarvis/portfolio/cockpit.sh` | executor script |
| `WIN_HOST` | — | passed through to `cockpit.sh` for SSH/rsync to the box |
| `FLEET_EXEC_TIMEOUT_S` | `600` | max seconds per verb |
| `FLEET_RESULT_MAXLEN` | `16000` | truncate captured output |
| `FLEET_MACHINE_NAME` | hostname | for logging only |
| `FLEET_DISPATCH_URL` | `…/functions/v1/dispatch` | wave-launch endpoint (M4) |
| `FLEET_REPO_ROOT` | `~/dev/jarvis` | where this machine's checkouts + `*-wt/` roots live |
| `FLEET_WAVE_POLL_INTERVAL_S` | `15` | wave poll interval (clamped 5…3600) |
| `FLEET_LAUNCH_CONCURRENCY` | `4` | max simultaneous launches (clamped 1…16) |
| `FLEET_LAUNCH_NO_SUBMIT` | *(unset)* | `1` = paste the directive, don't press Enter |
| `FLEET_COCKPIT_LOG_DIR` | `~/cockpit-logs` | pane logs + `.rc` sidecars (shared with the reporter) |
| `FLEET_CLAUDE_BIN` | `claude` | resolved to an absolute path via `PATH` at launch |

## Run

```bash
node agent/index.mjs                  # both loops: commands + wave-launch
node agent/index.mjs --once           # one claim cycle, then exit
node agent/index.mjs --wave-once      # ONE wave cycle (poll/claim/validate/launch/ack), then exit
node agent/test.mjs                   # offline security self-test (exit 0 = all passed)
node agent/test-launch.mjs            # offline wave-launch self-test (113 checks)
node agent/test-tmux-live.mjs         # LIVE tmux contract test (needs tmux; no claude, no bus)
node scripts/check-allowlist-parity.mjs   # verb parity + launch-gauntlet drift guard

# Offline wave drills (no bus, nothing spawned):
node agent/index.mjs --simulate-wave agent/fixtures/poll-hostile.json --expect-all-rejected
node agent/index.mjs --simulate-wave agent/fixtures/poll-selftest.json   # prints the exact argv

# Offline executor demos (no bus):
node agent/index.mjs --dry-run --simulate check
node agent/index.mjs --dry-run --simulate artifact '{"relpath":"cellular-gaits/outputs/run.json"}'
node agent/index.mjs --dry-run --simulate fetch-log '{"name":"nav; rm -rf ~"}'   # -> REJECTED
node agent/index.mjs --simulate check                                            # actually runs cockpit.sh check
```

## Deploy

- **macOS (Mac cockpit):** `deploy/launchd/com.fleet.agent.plist` — set `FLEET_TOKEN`,
  `WIN_HOST`, paths; `launchctl load` it.
- **Linux/WSL (sentry):** `deploy/systemd/fleet-agent.service` — put config in
  `/opt/fleet/agent/.env`. Note: unlike the read-only reporter unit, the agent **executes**
  `cockpit.sh` (which writes via git/ssh/rsync), so it can't use `ProtectSystem=strict` /
  `ReadOnlyPaths=/`; confidentiality is enforced in code, not the sandbox.

Never commit `.env` or real tokens. See repo `.env.example` for the agent config section.
