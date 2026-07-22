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
