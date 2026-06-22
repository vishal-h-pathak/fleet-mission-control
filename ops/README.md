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
