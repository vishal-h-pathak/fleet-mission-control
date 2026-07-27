#!/usr/bin/env node
// Fleet Mission Control — LIVE tmux contract test (needs tmux installed; no bus, no claude).
//
// Why this exists: the offline suite pins the argv STRINGS, which cannot tell you
// whether tmux actually accepts them. The 2026-07-27 live drill failed on exactly
// that gap — `=<name>` is a valid session target but an invalid PANE target, so
// `pipe-pane`/`capture-pane`/`send-keys` all failed SILENTLY (no log written, an
// empty readiness probe) and surfaced 40s later as a misleading "TUI never became
// ready". This test executes the real tmux commands against a throwaway session
// running `sleep`, so the target forms are verified against tmux itself.
//
// Deliberately does NOT launch `claude` — no tokens are spent here.
// Run:  node agent/test-tmux-live.mjs   (exit 0 = passed; exit 0 + SKIP if no tmux)

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { sessionTarget, paneTarget, resolveBin, SAFE_LOG_PATH_RE } from "./launch.mjs";

const tmux = resolveBin("tmux");
if (!tmux) {
  console.log("SKIP  tmux is not installed — live tmux contract test skipped (install: brew install tmux)");
  process.exit(0);
}

const sh = (argv, timeout = 15000) => {
  const r = spawnSync(tmux, argv, { encoding: "utf-8", timeout, shell: false });
  return { code: r.status === null ? 124 : r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0;
const ok = (name, cond, detail = "") => {
  if (cond) {
    passed++;
    console.log(`  ok  ${name}`);
  } else {
    console.error(`FAIL  ${name}${detail ? `\n      ${detail}` : ""}`);
    process.exitCode = 1;
  }
};

// Two sessions whose names share a prefix, so the exact-match assertions are real.
const NAME = `fleet-selftest-${process.pid}`;
const DECOY = `${NAME}-decoy`;
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fleet-tmux-"));
const logPath = path.join(tmpDir, `${NAME}.log`);

console.log(`Fleet live tmux contract test (${sh(["-V"]).stdout.trim()})\n`);

try {
  sh(["new-session", "-d", "-s", NAME, "-c", tmpDir, "sh", "-c", "sleep 120"]);
  sh(["new-session", "-d", "-s", DECOY, "-c", tmpDir, "sh", "-c", "sleep 120"]);

  // ── Session-target commands accept '=name' ─────────────────────────────────
  ok("has-session accepts the session-target form '=name'",
    sh(["has-session", "-t", sessionTarget(NAME)]).code === 0);
  ok("has-session with '=name' is EXACT (a shared prefix does not match)",
    sh(["has-session", "-t", sessionTarget(NAME.slice(0, -3))]).code !== 0,
    "a truncated name matched an existing session — exact matching is not in force");
  ok("has-session reports a nonexistent session as absent",
    sh(["has-session", "-t", sessionTarget(`${NAME}-nope`)]).code !== 0);

  // ── Pane-target commands REQUIRE '=name:' — the regression this test exists for ──
  const cap = sh(["capture-pane", "-pJ", "-t", paneTarget(NAME)]);
  ok("capture-pane accepts the pane-target form '=name:'", cap.code === 0, cap.stderr.trim());

  const badCap = sh(["capture-pane", "-pJ", "-t", sessionTarget(NAME)]);
  ok("capture-pane REJECTS the bare session form '=name' (the silent-failure trap)",
    badCap.code !== 0,
    "tmux accepted '=name' as a pane target — if this ever passes, re-check paneTarget()");

  ok("pane-target '=name:' is EXACT too",
    sh(["capture-pane", "-pJ", "-t", paneTarget(NAME.slice(0, -3))]).code !== 0);

  // ── pipe-pane actually writes the log the reporter tails ───────────────────
  ok("log path passes the metacharacter guard before interpolation", SAFE_LOG_PATH_RE.test(logPath));
  const pipe = sh(["pipe-pane", "-t", paneTarget(NAME), "-o", `cat >> '${logPath}'`]);
  ok("pipe-pane accepts '=name:'", pipe.code === 0, pipe.stderr.trim());

  // ── send-keys -l types literally into the pane, and capture-pane reads it back ──
  // This is the seed→confirm loop the launcher runs, with a directive-shaped string.
  const marker = "Read ./ops/prompts/PROMPT_fleet_conventions.md — do not begin until the operator confirms.";
  const keys = sh(["send-keys", "-t", paneTarget(NAME), "-l", marker]);
  ok("send-keys -l accepts '=name:'", keys.code === 0, keys.stderr.trim());

  let seen = "";
  for (let i = 0; i < 20; i++) {
    await sleep(250);
    seen = sh(["capture-pane", "-pJ", "-t", paneTarget(NAME)]).stdout;
    if (seen.includes(marker.slice(-24))) break;
  }
  ok("the seeded text is readable back from the pane (seed-confirm loop works)",
    seen.includes(marker.slice(-24)),
    `pane did not contain the tail marker; captured ${seen.length} chars`);

  await sleep(1000);
  const wrote = fs.existsSync(logPath) && fs.statSync(logPath).size > 0;
  ok("pipe-pane wrote pane output to the log file", wrote,
    "no log content — the reporter would see no log_tail for this session");

  // ── kill-session takes the session form, and really removes it ─────────────
  ok("kill-session accepts '=name'", sh(["kill-session", "-t", sessionTarget(NAME)]).code === 0);
  ok("the killed session is gone", sh(["has-session", "-t", sessionTarget(NAME)]).code !== 0);
  ok("the decoy session was untouched by the exact-match kill",
    sh(["has-session", "-t", sessionTarget(DECOY)]).code === 0);
} finally {
  sh(["kill-session", "-t", sessionTarget(NAME)]);
  sh(["kill-session", "-t", sessionTarget(DECOY)]);
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

console.log(`\n${passed} checks passed${process.exitCode ? " — WITH FAILURES" : ""}`);
