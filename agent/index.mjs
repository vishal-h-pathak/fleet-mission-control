#!/usr/bin/env node
// Fleet Mission Control — Control agent (P2-A, per machine)
// Turns allowlisted commands from the bus into real work via cockpit.sh, reports results back.
// SECURITY-CRITICAL: hard-coded verb allowlist, charset-whitelisted args, spawn shell:false,
// NEVER arbitrary shell. No service-role key — auth is the per-machine FLEET_TOKEN only.
// Zero npm deps, Node 18+, ESM. Same style as the reporter (../index.mjs).
//
// Usage:
//   node index.mjs                         # poll loop: claim -> running -> exec -> result
//   node index.mjs --once                  # one claim cycle, process, exit
//   node index.mjs --simulate <verb> [json]# run one verb locally (no bus); proves the executor
//   node index.mjs --dry-run --simulate <verb> [json]
//                                          # validate + print the cockpit.sh argv it WOULD run
//                                          # (no exec, no bus). Use to demo allowlist/arg checks.
//   node index.mjs --simulate <verb> [json] --approved-at <iso>
//                                          # simulate a CLAIMED row carrying an approval. Without
//                                          # it, a requiresApproval verb is shown then refused
//                                          # ("unapproved") and never executed — proves the gate.
//   node index.mjs --wave-once             # ONE wave-launch cycle (poll/claim/validate/launch/ack)
//   node index.mjs --simulate-wave <file>  # offline reject drill: run a DOCTORED poll response
//                     [--expect-all-rejected]
//                                          # through the real gauntlet. Never spawns; prints the
//                                          # accept/reject table + the argv each accept WOULD run.
//                                          # --expect-all-rejected exits 1 if anything survives.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { validateCommand, verbRequiresApproval, ALLOWED_VERBS } from "./allowlist.mjs";
import { runWaveCycle, launchConfigFromEnv, describeLaunchArgv } from "./launch.mjs";

// ── Config ──────────────────────────────────────────────────────────────────
const FLEET_TOKEN = env("FLEET_TOKEN");
const COMMANDS_URL = env("FLEET_COMMANDS_URL", "https://sbmsxerwgylpfkkkjtku.supabase.co/functions/v1/commands");
const COCKPIT_SH = resolveHome(env("COCKPIT_SH", "~/dev/jarvis/portfolio/cockpit.sh"));
const POLL_S = Number(env("FLEET_POLL_INTERVAL_S", "4"));
const MACHINE_NAME = env("FLEET_MACHINE_NAME", os.hostname());
const EXEC_TIMEOUT_MS = Number(env("FLEET_EXEC_TIMEOUT_S", "600")) * 1000; // cockpit verbs can ssh/rsync
const RESULT_MAXLEN = Number(env("FLEET_RESULT_MAXLEN", "16000"));        // truncate captured output
const AGENT_VERSION = "0.1.0";

// MCv2 M4 — wave-launch loop config (see agent/launch.mjs for the security model).
const LAUNCH_CFG = launchConfigFromEnv(process.env);
const RC_LINGER_S = 45; // --wave-once only: grace period for the /rc sidecar watcher

const DRY_RUN = process.argv.includes("--dry-run");
const ONCE = process.argv.includes("--once");
const SIMULATE = argValue("--simulate"); // verb to run locally without the bus
const WAVE_ONCE = process.argv.includes("--wave-once");
const SIMULATE_WAVE = argValue("--simulate-wave"); // path to a doctored poll response

// ── Entry ─────────────────────────────────────────────────────────────────────
let busy = false;     // declared before loop() runs at startup (avoid temporal-dead-zone)
let waveBusy = false; // ditto, for the wave-launch loop
if (SIMULATE_WAVE) {
  runSimulateWave(SIMULATE_WAVE);
} else if (SIMULATE) {
  // optional JSON args = token after the verb; --approved-at <iso> models an approved claim
  runSimulate(SIMULATE, simulateJsonArgs(), argValue("--approved-at"));
} else if (WAVE_ONCE) {
  if (!FLEET_TOKEN) {
    console.error("FATAL: FLEET_TOKEN is required for the wave loop (or use --simulate-wave for offline tests).");
    process.exit(1);
  }
  log(`wave-once — machine=${MACHINE_NAME} dispatch=${LAUNCH_CFG.dispatchUrl} repos=${LAUNCH_CFG.repoRoot} submit=${LAUNCH_CFG.submit}`);
  // If anything launched, linger briefly so the detached /rc watcher can write the
  // <name>.rc sidecar before we exit (in the long-running loop it has all the time
  // it needs). The reporter's log scrape is the backstop either way.
  waveLoop().then((summary) => {
    if (summary && summary.launched > 0) {
      log(`lingering ${RC_LINGER_S}s for the /rc sidecar watcher…`);
      setTimeout(() => process.exit(0), RC_LINGER_S * 1000);
    } else {
      process.exit(0);
    }
  });
} else {
  if (!FLEET_TOKEN) {
    console.error("FATAL: FLEET_TOKEN is required for the bus loop (or use --simulate for offline tests).");
    process.exit(1);
  }
  log(`agent starting — machine=${MACHINE_NAME} poll=${POLL_S}s verbs=[${ALLOWED_VERBS.join(", ")}] cockpit=${COCKPIT_SH}`);
  loop();
  // --once is a single COMMAND cycle that exits the process when it finishes, so the
  // wave loop deliberately does not start under it — a mid-flight launch must never
  // be cut in half by that exit. Use --wave-once for a one-shot wave cycle.
  if (!ONCE) {
    log(`wave-launch loop — dispatch=${LAUNCH_CFG.dispatchUrl} poll=${LAUNCH_CFG.wavePollS}s repos=${LAUNCH_CFG.repoRoot} cap=${LAUNCH_CFG.concurrency} submit=${LAUNCH_CFG.submit}`);
    waveLoop();
    setInterval(loop, POLL_S * 1000);
    setInterval(waveLoop, LAUNCH_CFG.wavePollS * 1000);
  }
}

// ── Poll loop: claim → running → exec → result ────────────────────────────────
// (busy flag declared in the Entry section above; claims are atomic server-side anyway)
async function loop() {
  if (busy) return;
  busy = true;
  try {
    const res = await bus({ action: "claim" });
    if (res.status !== 200) {
      log(`claim FAILED ${res.status}: ${res.body}`);
      return;
    }
    const claimed = parseClaimed(res.body);
    if (!claimed.length) return;
    log(`claimed ${claimed.length} command(s): ${claimed.map((c) => `${c.verb}#${short(c.id)}`).join(", ")}`);
    for (const cmd of claimed) {
      await handle(cmd);
    }
  } catch (err) {
    log(`loop error: ${err.message}`);
  } finally {
    busy = false;
    if (ONCE) process.exit(0);
  }
}

async function handle(cmd) {
  const { id, verb, args } = cmd;

  // 1) Validate against the hard-coded allowlist BEFORE doing anything else.
  const v = validateCommand(verb, args);
  if (!v.ok) {
    log(`reject ${verb}#${short(id)}: ${v.reason}`);
    await report(id, "rejected", v.reason);
    return; // nothing executed
  }

  // 1b) Approval gate (defense-in-depth). The agent only ever claims 'pending' rows and the
  // Edge Function holds unapproved mutating commands at 'awaiting_approval' — but even if a
  // requiresApproval verb somehow reached us without a non-null approved_at, refuse it.
  if (verbRequiresApproval(verb) && !cmd.approved_at) {
    log(`reject ${verb}#${short(id)}: unapproved (requiresApproval, approved_at=null)`);
    await report(id, "rejected", "unapproved");
    return; // nothing executed
  }

  // 2) Mark running.
  const r = await bus({ action: "running", id });
  if (r.status !== 200) log(`running mark FAILED ${r.status}: ${r.body}`);

  // 3) Execute the mapped cockpit.sh invocation (argv array, shell:false).
  log(`run ${verb}#${short(id)} -> cockpit.sh ${v.argv.join(" ")}`);
  const out = execCockpit(v.argv);

  // 4) Report result.
  const status = out.exit_code === 0 ? "done" : "error";
  await report(id, status, out.result, out.exit_code);
  log(`done ${verb}#${short(id)} status=${status} exit=${out.exit_code}`);
}

// ── Wave-launch loop (MCv2 M4): poll → claim → validate → launch → ack ────────
// Runs BESIDE the command loop, on its own interval and its own busy flag. It is
// fail-soft by construction: runWaveCycle never throws, and this wrapper catches
// anything that somehow escapes, because a bad wave must never take down the
// agent's telemetry or command path.
// Returns the cycle summary (or null if it was skipped/failed) — `--wave-once`
// needs it to decide whether to linger for the detached /rc sidecar watcher.
async function waveLoop() {
  if (waveBusy) return null;
  waveBusy = true;
  try {
    return await runWaveCycle({ bus: dispatchBus, cfg: LAUNCH_CFG, log });
  } catch (err) {
    log(`wave loop error: ${err.message}`);
    return null;
  } finally {
    waveBusy = false;
  }
}

// The dispatch Edge Function — a SEPARATE function from `commands` by design
// (execution surface vs telemetry sink). Same per-machine FLEET_TOKEN; the machine
// identity comes from the token, never from the request body.
async function dispatchBus(body) {
  return postJSON(LAUNCH_CFG.dispatchUrl, body, FLEET_TOKEN);
}

// ── --simulate-wave: the offline reject drill (no bus, no spawn) ──────────────
// Feeds a DOCTORED poll response through the real claim→validate path with a spy
// in place of the launcher, so hostile payloads (non-allowlisted repo, '../'
// prompt_ref, flag-injection branch/name) are proven to be rejected with error
// acks and nothing spawned. Accepted rows print the exact argv they WOULD run.
function runSimulateWave(file) {
  let poll;
  try {
    poll = fs.readFileSync(file, "utf-8");
    JSON.parse(poll);
  } catch (e) {
    console.error(`bad --simulate-wave file '${file}': ${e.message}`);
    process.exit(2);
  }
  const acks = [];
  const wouldLaunch = [];
  const bus = async (body) => {
    if (body.action === "poll") return { status: 200, body: poll };
    if (body.action === "claim") {
      // Model a WON claim so every row reaches the gauntlet — the point of the
      // drill is what the agent does with hostile input, not the race.
      return { status: 200, body: JSON.stringify({ ok: true, won: true, session_id: body.session_id }) };
    }
    if (body.action === "ack") {
      acks.push(body);
      return { status: 200, body: JSON.stringify({ ok: true, wave_status: "launching" }) };
    }
    return { status: 400, body: '{"error":"unknown_action"}' };
  };
  const launch = async (plan) => {
    wouldLaunch.push(plan);
    return { ok: true, detail: { tmux: plan.name, simulated: true } };
  };

  runWaveCycle({ bus, cfg: LAUNCH_CFG, log, launch }).then((summary) => {
    console.log(`\n── simulate-wave: ${file} ─────────────────────────────────────`);
    for (const r of summary.results) {
      const verdict = r.outcome === "launched" ? "ACCEPT" : "REJECT";
      console.log(`  ${verdict}  ${r.name}  ${r.reason ? `— ${r.reason}` : ""}`);
    }
    console.log(`\n  acks: ${acks.length} (${acks.filter((a) => a.ok === false).length} error-acks)`);
    for (const a of acks) console.log(`    ack ok=${a.ok} ${a.error ? `error="${a.error}"` : ""}`);
    if (wouldLaunch.length) {
      console.log(`\n  WOULD LAUNCH ${wouldLaunch.length} session(s) — exact argv (nothing was spawned):`);
      for (const plan of wouldLaunch) {
        console.log(`    ${plan.name}:`);
        for (const s of describeLaunchArgv(plan, LAUNCH_CFG)) {
          console.log(`      ${s.step.padEnd(13)} ${s.tool} ${JSON.stringify(s.argv)}`);
        }
      }
    } else {
      console.log("\n  NOTHING would be spawned.");
    }
    console.log(
      `\n  polled=${summary.polled} claimed=${summary.claimed} launched(simulated)=${summary.launched} ` +
      `rejected=${summary.rejected} skipped=${summary.skipped}`
    );
    if (process.argv.includes("--expect-all-rejected") && wouldLaunch.length > 0) {
      console.error(`\nFAIL: --expect-all-rejected, but ${wouldLaunch.length} session(s) survived the gauntlet.`);
      process.exit(1);
    }
    process.exit(0);
  });
}

// ── Executor: cockpit.sh via spawnSync, shell:false, NEVER a shell string ──────
function execCockpit(argv) {
  const r = spawnSync(COCKPIT_SH, argv, {
    encoding: "utf-8",
    timeout: EXEC_TIMEOUT_MS,
    maxBuffer: 8 * 1024 * 1024,
    shell: false, // ← argv is passed verbatim; no shell parsing of args, ever
  });

  if (r.error) {
    // spawn failed (e.g. cockpit.sh missing/not executable) or timed out
    const reason = r.error.code === "ETIMEDOUT" ? `timed out after ${EXEC_TIMEOUT_MS / 1000}s` : r.error.message;
    return { exit_code: 124, result: { stdout: trunc(r.stdout || ""), stderr: trunc((r.stderr || "") + `\n[spawn error] ${reason}`) } };
  }

  const exit_code = r.status === null ? 124 : r.status; // null => killed by signal/timeout
  return {
    exit_code,
    result: {
      stdout: trunc(r.stdout || ""),
      stderr: trunc(r.stderr || ""),
      ...(r.signal ? { signal: r.signal } : {}),
    },
  };
}

// ── Bus client (token-authed commands function; NO service-role key) ───────────
async function bus(body) {
  return postJSON(COMMANDS_URL, body, FLEET_TOKEN);
}

async function report(id, status, result, exit_code) {
  const body = { action: "result", id, status };
  if (result !== undefined) body.result = result;
  if (exit_code !== undefined) body.exit_code = exit_code;
  const res = await bus(body);
  if (res.status !== 200) log(`result POST FAILED ${res.status}: ${res.body}`);
  return res;
}

function parseClaimed(body) {
  try {
    const j = JSON.parse(body);
    return Array.isArray(j.claimed) ? j.claimed : [];
  } catch {
    return [];
  }
}

// ── --simulate: run/validate one verb locally, no bus ─────────────────────────
function runSimulate(verb, jsonArgs, approvedAt) {
  let args = {};
  if (jsonArgs) {
    try {
      args = JSON.parse(jsonArgs);
    } catch (e) {
      console.error(`bad --simulate JSON args: ${e.message}`);
      process.exit(2);
    }
  }
  const v = validateCommand(verb, args);
  if (!v.ok) {
    console.log(`REJECTED: ${verb} ${JSON.stringify(args)}\n  reason: ${v.reason}`);
    process.exit(0); // a rejection is a successful demonstration, not an error
  }
  console.log(`ALLOWED: ${verb} ${JSON.stringify(args)}\n  -> spawnSync(${JSON.stringify(COCKPIT_SH)}, ${JSON.stringify(v.argv)}, {shell:false})`);

  // Approval gate — same check the bus path applies in handle(). Model the claimed row's
  // approved_at via --approved-at; without it, a requiresApproval verb is refused (not run).
  if (verbRequiresApproval(verb) && !approvedAt) {
    console.log(`  requiresApproval: true, approved_at=null -> REJECTED: unapproved (not executed)`);
    process.exit(0);
  }
  if (verbRequiresApproval(verb)) {
    console.log(`  requiresApproval: true, approved_at=${JSON.stringify(approvedAt)} -> approved, proceeding`);
  }

  if (DRY_RUN) {
    console.log("(--dry-run: not executing)");
    process.exit(0);
  }
  const out = execCockpit(v.argv);
  console.log(`exit_code: ${out.exit_code}`);
  if (out.result.stdout) console.log(`--- stdout ---\n${out.result.stdout}`);
  if (out.result.stderr) console.log(`--- stderr ---\n${out.result.stderr}`);
  process.exit(out.exit_code === 0 ? 0 : 1);
}

// ── Utilities (mirrors ../index.mjs) ──────────────────────────────────────────
function trunc(s) {
  if (s.length <= RESULT_MAXLEN) return s;
  return s.slice(0, RESULT_MAXLEN) + `\n…[truncated ${s.length - RESULT_MAXLEN} chars]`;
}

function short(id) {
  return String(id ?? "").slice(0, 8);
}

// Value following a flag in argv. nth=1 → first token after flag, nth=2 → second.
function argValue(flag, nth = 1) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + nth] ? process.argv[i + nth] : null;
}

// JSON args token for --simulate: the token right after the verb, unless it's a flag.
function simulateJsonArgs() {
  const t = argValue("--simulate", 2);
  return t && !t.startsWith("--") ? t : null;
}

function env(key, fallback) {
  return process.env[key] ?? fallback ?? "";
}

function resolveHome(p) {
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

function log(msg) {
  console.log(`[fleet-agent] ${new Date().toISOString()} ${msg}`);
}

async function postJSON(url, body, token) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text };
}
