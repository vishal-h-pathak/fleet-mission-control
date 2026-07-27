// Fleet Mission Control — MCv2 M4 wave-launch loop (SECURITY-CRITICAL).
//
// This module is the code that turns a web click into processes on this machine:
// poll the `dispatch` Edge Function → claim → REVALIDATE EVERYTHING → launch a
// tmux `claude` session on the validated worktree → ack. Zero npm deps, Node 18+,
// ESM, same style as the command loop next door.
//
// Threat model (SCHEMA_V2 "Security invariants"): the bus is UNTRUSTED input. The
// dispatch function already scopes work to this machine and refuses to transport
// directives, but none of that is load-bearing here — every field is re-checked
// against agent/allowlist.mjs's hard-coded launch gauntlet before anything spawns.
//
// Where bus data may reach an argv, and nowhere else:
//   `repo`       -> never in an argv. It selects a HARD-CODED entry in LAUNCH_REPOS;
//                   the checkout + worktree-root strings come from that entry.
//   `name`       -> tmux -s/-t target, and the final worktree path segment.
//                   Charset [A-Za-z0-9._-]{1,64}, no leading '-' or '.'.
//   `branch`     -> `git worktree add` branch arg. Safe segments, no leading '-'.
//   `model`      -> `claude --model <model>`. Closed set {haiku,sonnet,opus}.
//   `prompt_ref` -> `git cat-file -e origin/main:<ref>`, and interpolated into the
//                   COMPOSED directive. Matches PROMPT_REF_RE; '/' is outside the
//                   PROMPT_ charset so traversal is unrepresentable.
//   `id`         -> JSON bodies only (claim/ack), uuid-shaped. Never an argv.
// `directive`, `worktree`, `last_message`, `rc_url`, `pr_url` reach NOTHING: the
// directive is composed locally (composeDirective) and the worktree path is
// computed locally. Everything spawns with shell:false and an argv array.
//
// Launch contracts deliberately replicated from portfolio's `cg runi` (whose
// transport is ssh-to-the-sentry-box and therefore unusable here — see the
// "runi-local convergence" follow-up in agent/README.md):
//   - tmux session name == the session's REGISTERED name, so the completion hook's
//     JOB_NAME matches and ingest's rung-2 `(machine_id, name)` ladder binds the
//     live process to its planned row by construction.
//   - the pane is piped to $FLEET_COCKPIT_LOG_DIR/<name>.log, the same path the
//     reporter tails for log_tail/progress/metrics.
//   - the /rc URL is written to $FLEET_COCKPIT_LOG_DIR/<name>.rc, the Phase-B
//     sidecar the reporter reads (private → fleet_job_links.rc_url).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { validateLaunchSession } from "./allowlist.mjs";
import { extractRcUrl } from "../rc.mjs";

// ── Timeouts / bounds (all fail-soft; a launch never blocks the agent forever) ──
export const TIMEOUTS = Object.freeze({
  gitFetchMs: 180_000,
  gitMs: 30_000,
  tmuxMs: 15_000,
  readyPolls: 80,        // × 500ms = up to 40s for the TUI to mount and settle
  seedPolls: 20,         // × 500ms = up to 10s to confirm the seed landed
  rcPolls: 150,          // × 1000ms = up to 150s to catch the /rc URL
});

// A pane log path is interpolated into ONE shell string (tmux pipe-pane runs its
// argument through a shell — that is tmux's contract, not ours). The path is built
// from a validated name plus an operator-controlled env dir, so we additionally
// refuse any path carrying a shell metacharacter before it is ever used.
export const SAFE_LOG_PATH_RE = /^[A-Za-z0-9._\/-]+$/;

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;?]*[ -\/]*[@-~]/g;

// Compare text against what a TUI actually renders. The claude input box SOFT-WRAPS
// a long directive across several lines and indents the continuations, and those are
// real newlines in the pane — `capture-pane -J` only rejoins lines tmux itself
// wrapped, so it does not put them back together. Comparing raw text therefore fails
// on any directive long enough to wrap (which is all of them). Strip ANSI, collapse
// every whitespace run to one space, and the seed-confirmation becomes wrap-agnostic.
export function normalizePane(s) {
  return String(s || "").replace(ANSI_RE, "").replace(/\s+/g, " ").trim();
}

// How much of the directive's tail must be visible to call the seed confirmed. The
// TAIL specifically (not any substring): it is the proof that the WHOLE directive
// landed, so a truncated or dropped paste is reported instead of blindly submitted.
export const SEED_MARK_LEN = 32;
export const seedMark = (directive) => normalizePane(directive).slice(-SEED_MARK_LEN);

// ── Config ───────────────────────────────────────────────────────────────────
export function launchConfigFromEnv(e = process.env) {
  return Object.freeze({
    dispatchUrl: e.FLEET_DISPATCH_URL || "https://sbmsxerwgylpfkkkjtku.supabase.co/functions/v1/dispatch",
    repoRoot: resolveHome(e.FLEET_REPO_ROOT || "~/dev/jarvis"),
    logDir: resolveHome(e.FLEET_COCKPIT_LOG_DIR || "~/cockpit-logs"),
    // Simultaneous launches. Each one is a full `claude` TUI; 4 is the default cap.
    concurrency: clampInt(e.FLEET_LAUNCH_CONCURRENCY, 4, 1, 16),
    wavePollS: clampInt(e.FLEET_WAVE_POLL_INTERVAL_S, 15, 5, 3600),
    // Seed AND submit by default: the wave-level human gate is the cockpit's
    // Confirm screen, and the session-level gate is the directive's own STOP
    // ("Do not begin until the operator confirms"), steerable from a phone via
    // /rc. FLEET_LAUNCH_NO_SUBMIT=1 pastes the directive and stops — used for the
    // acceptance drill, and for any operator who wants a keyboard gate.
    submit: e.FLEET_LAUNCH_NO_SUBMIT !== "1",
    claudeBin: e.FLEET_CLAUDE_BIN || "claude",
  });
}

// ── Pure argv builders (no I/O — the unit tests assert these exactly) ─────────
// `worktreeMode` is decided at runtime from the local repo state:
//   "local"  — refs/heads/<branch> exists          -> attach the existing branch
//   "remote" — refs/remotes/origin/<branch> exists -> track it
//   "new"    — neither                             -> create it from origin/main
//   "reuse"  — the worktree directory already exists -> no `worktree add` at all
// The `--` end-of-options guard is used wherever git accepts it (verified against
// this git: `worktree add`, `show-ref`, `cat-file -e`), so a value that somehow got
// past the validators still could not be read as a flag. `rev-parse --abbrev-ref`
// is the one exception — it echoes a trailing `--` — and it takes no bus data.
export function worktreeArgv(plan, worktreeMode) {
  const g = ["-C", plan.repoDir, "worktree", "add"];
  switch (worktreeMode) {
    case "local":  return [...g, "--", plan.worktreePath, plan.branch];
    case "remote": return [...g, "--track", "-b", plan.branch, "--", plan.worktreePath, `origin/${plan.branch}`];
    case "new":    return [...g, "-b", plan.branch, "--", plan.worktreePath, "origin/main"];
    default: throw new Error(`unknown worktree mode: ${worktreeMode}`);
  }
}

export function launchPaths(plan, cfg) {
  const logPath = path.join(cfg.logDir, `${plan.name}.log`);
  const rcPath = path.join(cfg.logDir, `${plan.name}.rc`);
  return { logPath, rcPath };
}

// tmux targets. The leading `=` forces an EXACT session-name match instead of
// tmux's default prefix/fnmatch resolution — important because the name comes
// from the bus: without it, `w3` could resolve to a session called `w3-drill`.
//
// The two forms are NOT interchangeable, and getting this wrong fails silently:
//   - session-target commands (has-session, kill-session) take `=<name>`
//   - pane-target commands (capture-pane, send-keys, pipe-pane) take `=<name>:`
//     — a bare `=<name>` is rejected with "can't find pane", which for pipe-pane
//     means no log is ever written and for capture-pane means the readiness probe
//     reads an empty string forever. Verified against tmux 3.7b; `=<name>:` is
//     confirmed exact (`=prob:` does not match a session named `probe`).
export const sessionTarget = (name) => `=${name}`;
export const paneTarget = (name) => `=${name}:`;

// THE ordered sequence of external invocations a launch performs — the single
// source of truth for both the executor below and the tests/simulator. launchSession
// looks its commands up here by step name rather than hand-building argv a second
// time, so what the unit tests assert is exactly what runs. `bins` carries the
// resolved absolute executables.
//
// Not listed (target-only auxiliaries carrying no bus data beyond the already-
// validated tmux target): `capture-pane -pJ -t =<name>` while waiting for the TUI,
// `has-session -t =<name>` while watching, and `kill-session -t =<name>` on cleanup.
export function describeLaunchArgv(plan, cfg, { worktreeMode = "new", bins = {} } = {}) {
  const git = bins.git || "git";
  const tmux = bins.tmux || "tmux";
  const claude = bins.claude || cfg.claudeBin;
  const { logPath } = launchPaths(plan, cfg);
  const st = sessionTarget(plan.name); // has-session / kill-session
  const t = paneTarget(plan.name);     // capture-pane / send-keys / pipe-pane
  const reuse = worktreeMode === "reuse";
  const steps = [
    { step: "repo-check",   tool: git,  argv: ["-C", plan.repoDir, "rev-parse", "--git-dir"] },
    { step: "fetch",        tool: git,  argv: ["-C", plan.repoDir, "fetch", "--quiet", "origin"] },
    { step: "prompt-check", tool: git,  argv: ["-C", plan.repoDir, "cat-file", "-e", "--", `origin/main:${plan.promptRef}`] },
    { step: "tmux-free",    tool: tmux, argv: ["has-session", "-t", st] },
    ...(reuse
      ? [{ step: "worktree-head", tool: git, argv: ["-C", plan.worktreePath, "rev-parse", "--abbrev-ref", "HEAD"] }]
      : [
        { step: "branch-local",  tool: git, argv: ["-C", plan.repoDir, "show-ref", "--verify", "--quiet", "--", `refs/heads/${plan.branch}`] },
        { step: "branch-remote", tool: git, argv: ["-C", plan.repoDir, "show-ref", "--verify", "--quiet", "--", `refs/remotes/origin/${plan.branch}`] },
        { step: "worktree",      tool: git, argv: worktreeArgv(plan, worktreeMode) },
      ]),
    { step: "new-session", tool: tmux, argv: [
      "new-session", "-d", "-s", plan.name, "-c", plan.worktreePath,
      claude, "--model", plan.model, "--rc", "--permission-mode", "bypassPermissions",
    ] },
    { step: "pipe-pane",   tool: tmux, argv: ["pipe-pane", "-t", t, "-o", `cat >> '${logPath}'`] },
    { step: "seed",        tool: tmux, argv: ["send-keys", "-t", t, "-l", plan.directive] },
  ];
  if (cfg.submit) steps.push({ step: "submit", tool: tmux, argv: ["send-keys", "-t", t, "Enter"] });
  return steps;
}

// Step lookup by name, for the executor: `S(mode).fetch` -> { tool, argv }.
function stepMap(plan, cfg, worktreeMode, bins) {
  return Object.fromEntries(
    describeLaunchArgv(plan, cfg, { worktreeMode, bins }).map((s) => [s.step, s])
  );
}

// ── The launcher ─────────────────────────────────────────────────────────────
// Returns { ok:true, detail } | { ok:false, error } — never throws, never retries.
// A failed launch is terminal for this session by contract (the dispatch function
// does not re-offer a session carrying launch_error), so recovery is an explicit
// operator re-dispatch, not an automatic retry.
export async function launchSession(plan, cfg, log = () => {}) {
  const bins = {};
  for (const name of ["git", "tmux", cfg.claudeBin]) {
    const abs = resolveBin(name);
    if (!abs) {
      return fail(name === "tmux"
        ? "tmux is not installed on this machine (install it: `brew install tmux`) — nothing was launched"
        : `required executable not found on PATH: ${name}`);
    }
    bins[name === cfg.claudeBin ? "claude" : name] = abs;
  }

  const { logPath, rcPath } = launchPaths(plan, cfg);
  if (!SAFE_LOG_PATH_RE.test(logPath)) {
    return fail(`refusing to launch: log path contains shell metacharacters (check FLEET_COCKPIT_LOG_DIR)`);
  }
  try {
    fs.mkdirSync(cfg.logDir, { recursive: true });
  } catch (e) {
    return fail(`cannot create log dir ${cfg.logDir}: ${e.message}`);
  }

  // Every command below is looked up from describeLaunchArgv — the same data the
  // unit tests pin — so the executed argv cannot drift from the asserted argv.
  const reuseWorktree = fs.existsSync(plan.worktreePath);
  const probe = stepMap(plan, cfg, reuseWorktree ? "reuse" : "new", bins);
  const run = (s, timeout = TIMEOUTS.gitMs) => sh(s.tool, s.argv, timeout);

  // The local checkout must exist and be a git repo before anything else.
  if (!fs.existsSync(plan.repoDir)) return fail(`local checkout missing: ${plan.repoDir}`);
  if (run(probe["repo-check"]).code !== 0) return fail(`not a git checkout: ${plan.repoDir}`);

  // (3) COMMITTED-PROMPTS-ONLY, enforced at execution: fetch, then require the
  // prompt to exist in origin/main. This is the structural guarantee that only
  // reviewed, versioned instructions can run on this box.
  const fetched = run(probe.fetch, TIMEOUTS.gitFetchMs);
  if (fetched.code !== 0) return fail(`git fetch origin failed: ${firstLine(fetched.stderr) || `exit ${fetched.code}`}`);
  if (run(probe["prompt-check"]).code !== 0) {
    return fail(`prompt_ref '${plan.promptRef}' does not exist in origin/main — committed prompts only`);
  }

  // Never clobber a live session that already owns this name.
  const sTarget = sessionTarget(plan.name); // has-session / kill-session
  const pTarget = paneTarget(plan.name);    // capture-pane
  if (run(probe["tmux-free"], TIMEOUTS.tmuxMs).code === 0) {
    return fail(`tmux session '${plan.name}' already exists — refusing to clobber it`);
  }

  // Worktree: reuse if present (and on the right branch), else create it.
  let worktreeMode = "new";
  if (reuseWorktree) {
    const head = run(probe["worktree-head"]);
    if (head.code !== 0) return fail(`worktree ${plan.worktreePath} exists but is not a git checkout`);
    const cur = head.stdout.trim();
    if (cur !== plan.branch) return fail(`worktree ${plan.worktreePath} exists on branch '${cur}', expected '${plan.branch}'`);
    worktreeMode = "reuse";
    log(`worktree reuse ${plan.worktreePath} (${plan.branch})`);
  } else {
    const hasLocal = run(probe["branch-local"]).code === 0;
    const hasRemote = run(probe["branch-remote"]).code === 0;
    worktreeMode = hasLocal ? "local" : hasRemote ? "remote" : "new";
    const add = run(stepMap(plan, cfg, worktreeMode, bins).worktree);
    if (add.code !== 0) return fail(`git worktree add (${worktreeMode}) failed: ${firstLine(add.stderr) || `exit ${add.code}`}`);
    log(`worktree ${worktreeMode} ${plan.worktreePath} (${plan.branch})`);
  }

  // Launch the interactive session. NOT -p: a live TUI bound to the tmux pane's
  // pty is what makes /rc steering and the in-session STOP gate work at all.
  const S = stepMap(plan, cfg, worktreeMode, bins);
  const created = run(S["new-session"], TIMEOUTS.tmuxMs);
  if (created.code !== 0) return fail(`tmux new-session failed: ${firstLine(created.stderr) || `exit ${created.code}`}`);

  // Everything past this point cleans up its own tmux session on failure, so a
  // launch_error never leaves a half-seeded TUI sitting on the machine.
  const abort = (reason) => {
    sh(bins.tmux, ["kill-session", "-t", sTarget], TIMEOUTS.tmuxMs);
    return fail(reason);
  };

  // Interactive => capture the PANE (a tee pipe would kill the TUI), to the same
  // log path the reporter already tails.
  run(S["pipe-pane"], TIMEOUTS.tmuxMs);

  // Wait for the TUI to be mounted AND stable (two identical frames) before
  // typing — keystrokes sent mid-render are dropped.
  const ready = await waitForReady(bins.tmux, plan.name);
  if (!ready) return abort("the claude TUI never became ready in the launch window");

  // Seed once, literally, then CONFIRM the whole directive landed in the input box
  // before pressing Enter. A partial seed is reported, never blindly submitted.
  const seeded = run(S.seed, TIMEOUTS.tmuxMs);
  if (seeded.code !== 0) return abort(`tmux send-keys (seed) failed: ${firstLine(seeded.stderr) || `exit ${seeded.code}`}`);
  const mark = seedMark(plan.directive);
  let landed = false;
  for (let i = 0; i < TIMEOUTS.seedPolls; i++) {
    await sleep(500);
    if (normalizePane(capturePane(bins.tmux, plan.name)).includes(mark)) { landed = true; break; }
  }
  if (!landed) return abort("directive seed was not confirmed in the input box — not submitted");

  if (cfg.submit) {
    const sent = run(S.submit, TIMEOUTS.tmuxMs);
    if (sent.code !== 0) return abort(`tmux send-keys (submit) failed: ${firstLine(sent.stderr) || `exit ${sent.code}`}`);
  }

  // /rc sidecar watcher — detached and fail-soft. The reporter also scrapes the
  // pane log, so this is belt-and-braces for the deterministic path.
  watchRcUrl(bins.tmux, plan.name, logPath, rcPath, log);

  return {
    ok: true,
    detail: {
      tmux: plan.name,
      worktree: plan.worktreePath,
      worktreeMode,
      model: plan.model,
      logPath,
      rcPath,
      submitted: cfg.submit,
    },
  };
}

// ── The wave cycle: poll → claim → validate → launch → ack ───────────────────
// All I/O is injected so the offline simulator and the unit tests drive the exact
// same orchestration the live loop runs.
//   bus(body)   -> { status, body }            (the dispatch Edge Function)
//   launch(plan)-> { ok, detail } | { ok, error }
// Never throws: a per-session failure is acked and the cycle continues.
export async function runWaveCycle({ bus, cfg, log = () => {}, launch = null }) {
  const doLaunch = launch || ((plan) => launchSession(plan, cfg, log));
  const summary = { polled: 0, claimed: 0, launched: 0, rejected: 0, lost: 0, skipped: 0, results: [] };

  const res = await bus({ action: "poll" });
  if (res.status !== 200) {
    log(`wave poll FAILED ${res.status}: ${trunc1(res.body)}`);
    return summary;
  }
  let work = [];
  try {
    const j = JSON.parse(res.body);
    work = Array.isArray(j.work) ? j.work : [];
  } catch {
    log("wave poll returned unparseable JSON — ignoring");
    return summary;
  }
  summary.polled = work.length;
  if (!work.length) return summary;
  log(`wave poll: ${work.length} launchable session(s)`);

  await pool(work, cfg.concurrency, async (item) => {
    const session = item && typeof item === "object" ? item.session : null;
    const wave = item && typeof item === "object" ? item.wave : null;
    const id = session && typeof session.id === "string" ? session.id : null;
    const label = session && typeof session.name === "string" ? safeLabel(session.name) : "<unnamed>";

    // A session id we cannot even shape-check cannot be claimed or acked — there
    // is nothing to record against. Log loudly and move on.
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
      summary.skipped++;
      log(`wave skip ${label}: session id is not a uuid — cannot claim or ack`);
      summary.results.push({ name: label, outcome: "skipped", reason: "non-uuid session id" });
      return;
    }

    // Claim FIRST: only the machine holding the claim may ack, so a rejection has
    // to be claimed before it can be recorded as a launch_error.
    const claimRes = await bus({ action: "claim", session_id: id });
    if (claimRes.status !== 200) {
      summary.skipped++;
      log(`wave claim FAILED ${claimRes.status} for ${label}: ${trunc1(claimRes.body)}`);
      summary.results.push({ name: label, outcome: "claim-failed", reason: `http ${claimRes.status}` });
      return;
    }
    let claim = {};
    try { claim = JSON.parse(claimRes.body); } catch { claim = {}; }
    if (claim.won !== true) {
      summary.lost++;
      log(`wave claim lost for ${label}: ${claim.reason || "unknown"} (normal race outcome)`);
      summary.results.push({ name: label, outcome: "not-won", reason: claim.reason || "unknown" });
      return;
    }
    summary.claimed++;

    // THE GAUNTLET. Everything the bus said is revalidated against local truth.
    const v = validateLaunchSession({ session, wave, repoRoot: cfg.repoRoot });
    if (!v.ok) {
      summary.rejected++;
      log(`wave REJECT ${label}: ${v.reason}`);
      await ack(bus, id, false, `rejected by agent allowlist: ${v.reason}`, log);
      summary.results.push({ name: label, outcome: "rejected", reason: v.reason });
      return;
    }

    let out;
    try {
      out = await doLaunch(v.plan);
    } catch (err) {
      out = { ok: false, error: `launch threw: ${err.message}` };
    }
    if (!out || out.ok !== true) {
      summary.rejected++;
      const reason = (out && out.error) || "launch failed";
      log(`wave LAUNCH FAILED ${label}: ${reason}`);
      await ack(bus, id, false, reason, log);
      summary.results.push({ name: label, outcome: "launch-failed", reason });
      return;
    }
    summary.launched++;
    log(`wave LAUNCHED ${label} -> tmux '${v.plan.name}' (${v.plan.model}) in ${v.plan.worktreePath}`);
    await ack(bus, id, true, undefined, log);
    summary.results.push({ name: label, outcome: "launched", detail: out.detail });
  });

  return summary;
}

async function ack(bus, sessionId, okFlag, error, log) {
  const body = { action: "ack", session_id: sessionId, ok: okFlag };
  if (error !== undefined) body.error = String(error).slice(0, 2000);
  const res = await bus(body);
  if (res.status !== 200) log(`wave ack FAILED ${res.status}: ${trunc1(res.body)}`);
  return res;
}

// ── tmux helpers ─────────────────────────────────────────────────────────────
// These take the session NAME (not a pre-built target) and derive the correct
// form per command — mixing the two is the failure mode paneTarget documents.
function capturePane(tmux, name) {
  const r = sh(tmux, ["capture-pane", "-pJ", "-t", paneTarget(name)], TIMEOUTS.tmuxMs);
  return r.code === 0 ? r.stdout : "";
}

function sessionAlive(tmux, name) {
  return sh(tmux, ["has-session", "-t", sessionTarget(name)], TIMEOUTS.tmuxMs).code === 0;
}

async function waitForReady(tmux, name) {
  let prev = "";
  let stable = 0;
  for (let i = 0; i < TIMEOUTS.readyPolls; i++) {
    const pane = capturePane(tmux, name);
    if (/for shortcuts|bypass permission|esc to interrupt/i.test(pane)) {
      stable = pane === prev ? stable + 1 : 0;
      if (stable >= 2) return true;
    }
    prev = pane;
    if (!sessionAlive(tmux, name)) return false;
    await sleep(500);
  }
  return false;
}

// Detached, unref'd, fail-soft: writes $LOG_DIR/<name>.rc (first line = URL), the
// exact file the reporter reads and routes to private fleet_job_links.rc_url.
function watchRcUrl(tmux, name, logPath, rcPath, log) {
  let n = 0;
  const tick = () => {
    n++;
    try {
      const fromLog = fs.existsSync(logPath) ? fs.readFileSync(logPath, "utf-8").replace(ANSI_RE, "") : "";
      const fromPane = capturePane(tmux, name).replace(ANSI_RE, "");
      const url = extractRcUrl(`${fromLog}\n${fromPane}`);
      if (url) {
        fs.writeFileSync(rcPath, `${url}\n`, "utf-8");
        log(`/rc captured -> ${rcPath}`);
        return;
      }
      if (!sessionAlive(tmux, name)) return;
    } catch { /* fail-soft: the reporter still scrapes the log */ }
    if (n < TIMEOUTS.rcPolls) setTimeout(tick, 1000).unref?.();
  };
  setTimeout(tick, 2000).unref?.();
}

// ── Small utilities ──────────────────────────────────────────────────────────
// Every external invocation goes through here: argv array, shell:false, timeout.
function sh(bin, argv, timeout) {
  const r = spawnSync(bin, argv, { encoding: "utf-8", timeout, maxBuffer: 4 * 1024 * 1024, shell: false });
  if (r.error) return { code: 127, stdout: "", stderr: r.error.message };
  return { code: r.status === null ? 124 : r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}

// Resolve a bare executable name to an absolute path via PATH. tmux inherits the
// agent's environment, so pinning absolute paths removes any PATH ambiguity about
// which binary a launched session actually runs.
export function resolveBin(name) {
  if (name.includes("/")) return fs.existsSync(name) ? name : null;
  for (const dir of (process.env.PATH || "").split(":")) {
    if (!dir) continue;
    const p = path.join(dir, name);
    try {
      fs.accessSync(p, fs.constants.X_OK);
      return p;
    } catch { /* keep looking */ }
  }
  return null;
}

// Bounded-concurrency map. Rejections inside `fn` are contained per item.
// Honest about what "concurrent" means here: the external commands run through
// spawnSync, so launches interleave at the await points (the readiness/seed waits,
// which dominate the wall clock) rather than truly running in parallel. The cap is
// therefore a bound on how many TUIs are mid-launch, which is what it is for.
async function pool(items, limit, fn) {
  const queue = [...items];
  const workers = Array.from({ length: Math.max(1, Math.min(limit, queue.length)) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      try {
        await fn(item);
      } catch { /* fail-soft: one bad session never stops the wave */ }
    }
  });
  await Promise.all(workers);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (error) => ({ ok: false, error });
const firstLine = (s) => String(s || "").split("\n").find((l) => l.trim()) || "";
const trunc1 = (s) => String(s || "").replace(/\s+/g, " ").slice(0, 300);
// eslint-disable-next-line no-control-regex
const safeLabel = (s) => JSON.stringify(String(s).slice(0, 64).replace(/[\x00-\x1f\x7f]/g, "?"));

function clampInt(raw, dflt, min, max) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return dflt;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function resolveHome(p) {
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}
