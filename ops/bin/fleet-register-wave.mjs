#!/usr/bin/env node
// fleet-register-wave — record a dispatched wave of `planned` sessions on the bus.
//
// Zero-dep Node 18+ ESM. A wave launcher (ops/waves/setup-*.sh) calls this at
// dispatch so each Code session exists as a work item BEFORE it runs; ingest v5 then
// enriches it (planned → running → done) as telemetry lands. Records intent only —
// nothing here is executed. See docs/SCHEMA_V2.md.
//
// Usage:
//   fleet-register-wave --manifest wave.json
//   fleet-register-wave --project portfolio --wave w1 --name feat/x --branch feat/x \
//                       --machine sentry --model sonnet --prompt ops/prompts/PROMPT_x.md
//   ... add --dry-run to print the payload without POSTing.
//
// Env: FLEET_TOKEN (required unless --dry-run), FLEET_INGEST_URL (optional override).
//
// Manifest shape:
//   { "project": "portfolio",              // or "project_id": "<uuid>"
//     "wave":    { "name": "w1", "notes": "...", "status": "dispatched" },
//     "sessions":[ { "name": "feat/x", "machine": "sentry", "branch": "feat/x",
//                    "repo": "owner/name", "worktree": "../pf-wt/x", "model": "sonnet",
//                    "prompt_ref": "ops/prompts/PROMPT_x.md", "directive": "..." } ] }

import { readFileSync } from "node:fs";
import process from "node:process";

const DEFAULT_URL = "https://sbmsxerwgylpfkkkjtku.supabase.co/functions/v1/ingest";

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === "--dry-run") a.dryRun = true;
    else if (t === "-h" || t === "--help") a.help = true;
    else if (t.startsWith("--")) a[t.slice(2)] = argv[++i];
    else a._.push(t);
  }
  return a;
}

const HELP = `fleet-register-wave — register a wave of planned sessions on the fleet bus.

  --manifest <path>   JSON manifest (see header). Also accepted as a positional arg.
  --dry-run           Print the payload; do not POST. No token required.
  --url <url>         Override ingest URL (else FLEET_INGEST_URL or the default).

Single-session shortcut (used when no manifest is given):
  --project <name>    Project name (or --project-id <uuid>).
  --wave <name>       Wave name (required).
  --name <name>       Session name (tmux/job name, or the registered branch handle).
  --machine <name>    Target machine (default: the machine whose token auths).
  --branch <b>  --repo <owner/name>  --worktree <p>  --model <m>  --prompt <ref>

Env: FLEET_TOKEN (required unless --dry-run), FLEET_INGEST_URL (optional).`;

function buildManifest(a) {
  if (a.manifest || a._[0]) {
    const path = a.manifest ?? a._[0];
    let raw;
    try {
      raw = readFileSync(path, "utf8");
    } catch (e) {
      throw new Error(`cannot read manifest ${path}: ${e.message}`);
    }
    let m;
    try {
      m = JSON.parse(raw);
    } catch (e) {
      throw new Error(`manifest is not valid JSON: ${e.message}`);
    }
    return m;
  }
  // Flag-built single-session manifest.
  if (!a.wave) throw new Error("missing --wave (or provide a --manifest)");
  if (!a.name) throw new Error("missing --name (or provide a --manifest)");
  const session = { name: a.name };
  for (const [flag, key] of [
    ["machine", "machine"], ["branch", "branch"], ["repo", "repo"],
    ["worktree", "worktree"], ["model", "model"], ["prompt", "prompt_ref"],
    ["directive", "directive"], ["project", "project"],
  ]) {
    if (a[flag] != null) session[key] = a[flag];
  }
  const manifest = { wave: { name: a.wave }, sessions: [session] };
  if (a.notes) manifest.wave.notes = a.notes;
  if (a.status) manifest.wave.status = a.status;
  if (a["project-id"]) manifest.project_id = a["project-id"];
  else if (a.project) manifest.project = a.project;
  return manifest;
}

function validate(m) {
  if (!m || typeof m !== "object") throw new Error("manifest must be an object");
  if (m.project_id == null && (typeof m.project !== "string" || !m.project.trim())) {
    throw new Error("manifest needs a `project` name or `project_id`");
  }
  if (!m.wave || typeof m.wave.name !== "string" || !m.wave.name.trim()) {
    throw new Error("manifest.wave.name is required");
  }
  if (!Array.isArray(m.sessions) || m.sessions.length === 0) {
    throw new Error("manifest.sessions must be a non-empty array");
  }
  for (const s of m.sessions) {
    if (!s || typeof s.name !== "string" || !s.name.trim()) {
      throw new Error("every session needs a `name`");
    }
  }
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  if (a.help) {
    console.log(HELP);
    return;
  }

  let manifest;
  try {
    manifest = buildManifest(a);
    validate(manifest);
  } catch (e) {
    console.error(`error: ${e.message}\n`);
    console.error(HELP);
    process.exit(2);
  }

  const payload = { register: manifest };

  if (a.dryRun) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  const url = a.url ?? process.env.FLEET_INGEST_URL ?? DEFAULT_URL;
  const token = process.env.FLEET_TOKEN;
  if (!token) {
    console.error("error: FLEET_TOKEN is not set (needed to POST; use --dry-run to preview).");
    process.exit(2);
  }

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    console.error(`error: POST failed: ${e.message}`);
    process.exit(1);
  }

  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  if (!res.ok) {
    console.error(`error: ingest returned ${res.status}: ${text}`);
    process.exit(1);
  }

  const reg = body?.registered ?? {};
  console.log(`wave ${reg.wave_id ?? "?"} (project ${reg.project_id ?? "?"})`);
  for (const s of reg.sessions ?? []) console.log(`  session ${s.id}  ${s.name}`);
}

main().catch((e) => {
  console.error(`error: ${e.message}`);
  process.exit(1);
});
