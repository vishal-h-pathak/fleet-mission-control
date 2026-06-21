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

## Run

```bash
node agent/index.mjs                  # poll loop (claim -> running -> exec -> result)
node agent/index.mjs --once           # one claim cycle, then exit
node agent/test.mjs                   # offline security self-test (exit 0 = all passed)

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
