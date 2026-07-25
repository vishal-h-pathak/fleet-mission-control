# ops/ — operational meta-files (not source)

Agent-orchestration files for *building* Fleet Mission Control live here, so the repo root stays
clean for the actual system (`index.mjs`, `agent/`, `web/`, `supabase/`, `deploy/`). These have
nothing to do with *running* the fleet — see `docs/HOW_IT_WORKS.md` ("Do I have to run scripts every
time?" — no).

```
ops/
  prompts/            active PROMPT_fleet_*.md — one self-contained brief per Claude Code session
    archive/          prompts for shipped phases (P0/P1/P2 build)
  waves/              setup-fleet-*-wave.sh launchers (stage parallel CC sessions in worktrees)
    archive/          used-up wave scripts (P0/P1/P2)
```

Conventions (mirrors the sibling `cellular-gaits` and `portfolio` repos):
- **One prompt = one session.** Every wave session reads `ops/prompts/PROMPT_fleet_conventions.md`
  first (the frozen DB/security contract) then its phase prompt.
- **Move a prompt/wave to `archive/` once its phase has shipped.** Active = still to run
  (today: operationalize, Phase B `/rc` join, Phase C launch verb — see `docs/ROADMAP.md`).
- **Wave launchers** open a Terminal session per chunk in a git worktree under `../fleet-wt/`,
  seed it from `ops/prompts/` + `docs/`, launch `claude --permission-mode bypassPermissions`, and
  paste the directive unsubmitted for review before Return. Run them from the repo root, e.g.
  `bash ops/waves/setup-fleet-phaseC-wave.sh`.

Project docs (BRIEF, ROADMAP, HOW_IT_WORKS, SCHEMA, plans, and the loop-closer design) stay in
`docs/`; `README.md` + `ONBOARDING.md` stay at the root.

## `ops/bin/` — helpers a launcher calls

`fleet-register-wave.mjs` (MCv2, zero-dep Node 18+ ESM) records a dispatched wave of `planned`
sessions on the fleet bus so each Code run exists as a work item *before* it runs; ingest v5 then
enriches it (planned → running → done) as telemetry lands. See `docs/SCHEMA_V2.md`.

A `setup-*.sh` launcher registers the wave right after it decides the chunk table (branch / machine /
model / prompt per chunk), before opening the sessions. Preview first (`--dry-run` needs no token),
then register (needs `FLEET_TOKEN` for the dispatching machine):

```bash
# In setup-mcv2-wave1.sh, after the chunk list is known:
cat > /tmp/mcv2-wave1.json <<'JSON'
{ "project": "fleet-mission-control",
  "wave": { "name": "mcv2-wave1", "notes": "M0 hook-pr ∥ M1 schema" },
  "sessions": [
    { "name": "feat/mcv2-hook-pr", "machine": "mac-cockpit", "branch": "feat/mcv2-hook-pr",
      "model": "sonnet", "prompt_ref": "ops/prompts/PROMPT_mcv2_hook_pr.md" },
    { "name": "feat/mcv2-schema",  "machine": "mac-cockpit", "branch": "feat/mcv2-schema",
      "model": "opus",   "prompt_ref": "ops/prompts/PROMPT_mcv2_schema.md" }
  ] }
JSON

node ops/bin/fleet-register-wave.mjs --dry-run --manifest /tmp/mcv2-wave1.json   # preview payload
FLEET_TOKEN=… node ops/bin/fleet-register-wave.mjs --manifest /tmp/mcv2-wave1.json   # register → prints ids
```

Single-session shortcut (no manifest): `node ops/bin/fleet-register-wave.mjs --project portfolio
--wave w1 --name feat/x --branch feat/x --machine sentry --model sonnet --prompt ops/prompts/PROMPT_x.md`.
`--help` documents every flag. Registration only *records intent* — dispatch stays where it is today.

### `ops/waves/lib-register.sh` — sourceable wrapper for a `setup-*.sh` launcher

Building the manifest heredoc above by hand (as `setup-mcv2-wave2.sh` does inline) works
for one launcher; `lib-register.sh` extracts the same fail-soft pattern (mktemp manifest,
`FLEET_TOKEN` from the repo's gitignored env, warn-never-abort) into functions a launcher
sources instead of copy-pasting:

```bash
#!/usr/bin/env bash
set -euo pipefail
source ops/waves/lib-register.sh

fleet_register_init "fleet-mission-control" "mywave" "optional wave notes"
fleet_register_add "chunk-a" "feat/chunk-a" "mac-cockpit" "sonnet" \
                    "ops/prompts/PROMPT_chunk_a.md" "../fleet-wt/chunk-a" \
                    "vishal-h-pathak/fleet-mission-control"
fleet_register_add "chunk-b" "feat/chunk-b" "mac-cockpit" "opus" \
                    "ops/prompts/PROMPT_chunk_b.md" "../fleet-wt/chunk-b"

fleet_register_dispatch              # POSTs; prints the returned wave/session ids
# fleet_register_dispatch --dry-run  # preview the payload only, no token needed

# ... then open_session/add_worktree per chunk, as in setup-mcv2-wave1.sh
```

`FLEET_TOKEN` is read from `<repo-root>/.env` or `<repo-root>/.fleet-secrets.env` (first
bare `FLEET_TOKEN=` line wins) — repo root defaults to two levels up from
`ops/waves/lib-register.sh` itself, not the caller's cwd. **Gotcha:** a worktree launcher
that only seeds `.fleet-secrets.env` (not `.env`) into the worktree won't find a token
there — `.fleet-secrets.env` holds *per-machine* keys (`FLEET_TOKEN_MAC_COCKPIT=...`,
`FLEET_TOKEN_SENTRY=...`, for distributing to each machine's own `reporter/.env`), not a
bare `FLEET_TOKEN=`. Pass an explicit root to `fleet_register_dispatch <root>` (e.g. the
main repo checkout, which has `.env`) if the launcher's own cwd doesn't have one. Missing
token, jq, or node — or a non-200 response — all warn to stderr and return 0; a launcher
should call this *before* opening sessions but never gate dispatch on its success.
