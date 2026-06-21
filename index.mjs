#!/usr/bin/env node
// Fleet Mission Control — Reporter agent (P0)
// Standalone Node heartbeat daemon. Zero npm deps.
// Usage: node reporter/index.mjs [--dry-run] [--once]

import os from "node:os";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// ── Config ──────────────────────────────────────────────────────────────────
const FLEET_TOKEN = env("FLEET_TOKEN");
const INGEST_URL = env("FLEET_INGEST_URL", "https://sbmsxerwgylpfkkkjtku.supabase.co/functions/v1/ingest");
const INTERVAL_S = Number(env("FLEET_HEARTBEAT_INTERVAL_S", "10"));
const LOG_DIR = resolveHome(env("FLEET_COCKPIT_LOG_DIR", "~/cockpit-logs"));
const MACHINE_NAME = env("FLEET_MACHINE_NAME", os.hostname());
const AGENT_VERSION = "0.1.0";

const DRY_RUN = process.argv.includes("--dry-run");
const ONCE = process.argv.includes("--once");

// ── Startup ─────────────────────────────────────────────────────────────────
if (!DRY_RUN && !FLEET_TOKEN) {
  console.error("FATAL: FLEET_TOKEN is required (unless --dry-run).");
  process.exit(1);
}

const specs = collectSpecs();
let prevSessions = new Set(); // track tmux sessions for finished-job detection
let firstTick = true;

log(`reporter starting — machine=${MACHINE_NAME} interval=${INTERVAL_S}s dry=${DRY_RUN} once=${ONCE}`);

tick(); // first heartbeat immediately
if (!ONCE && !DRY_RUN) {
  setInterval(tick, INTERVAL_S * 1000);
}

// ── Main tick ───────────────────────────────────────────────────────────────
async function tick() {
  try {
    const heartbeat = collectHeartbeat();
    const { jobs, currentSessions } = collectJobs();

    // Detect finished sessions (skip on first tick to avoid false positives)
    if (!firstTick) {
      for (const name of prevSessions) {
        if (!currentSessions.has(name)) {
          const finished = buildFinishedJob(name);
          if (finished) jobs.push(finished);
        }
      }
    }
    firstTick = false;
    prevSessions = currentSessions;

    const payload = {
      machine: {
        os: os.platform(),
        arch: os.arch(),
        specs,
        agent_version: AGENT_VERSION,
      },
      heartbeat,
      jobs,
    };

    if (DRY_RUN) {
      console.log(JSON.stringify(payload, null, 2));
      process.exit(0);
    }

    const res = await postJSON(INGEST_URL, payload, FLEET_TOKEN);
    if (res.status === 200) {
      log(`heartbeat ok — cpu=${heartbeat.cpu_pct}% ram=${heartbeat.ram_pct}% jobs=${jobs.length}`);
    } else {
      log(`heartbeat FAILED ${res.status}: ${res.body}`);
    }

    if (ONCE) process.exit(res.status === 200 ? 0 : 1);
  } catch (err) {
    log(`tick error: ${err.message}`);
    if (ONCE) process.exit(1);
  }
}

// ── Host metrics ────────────────────────────────────────────────────────────
function collectHeartbeat() {
  const cpus = os.cpus();
  const cpu_pct = cpuPercent(cpus);
  const ram_total_mb = Math.round(os.totalmem() / 1048576);
  const ram_used_mb = Math.round((os.totalmem() - os.freemem()) / 1048576);
  const ram_pct = Math.round((ram_used_mb / ram_total_mb) * 100);
  const load_avg = os.loadavg().map((v) => Math.round(v * 100) / 100);
  const uptime_s = Math.round(os.uptime());
  const gpu = collectGpu();

  return { cpu_pct, ram_pct, ram_used_mb, ram_total_mb, load_avg, gpu, uptime_s, raw: {} };
}

function cpuPercent(cpus) {
  let idleTotal = 0, total = 0;
  for (const c of cpus) {
    for (const t of Object.values(c.times)) total += t;
    idleTotal += c.times.idle;
  }
  return Math.round(((total - idleTotal) / total) * 100);
}

function collectSpecs() {
  const cpus = os.cpus();
  const gpuNames = [];
  try {
    const out = run("nvidia-smi --query-gpu=name --format=csv,noheader,nounits");
    for (const line of out.split("\n")) {
      const name = line.trim();
      if (name) gpuNames.push(name);
    }
  } catch { /* no nvidia-smi */ }

  return {
    cpu_model: cpus[0]?.model ?? "unknown",
    cpu_cores: cpus.length,
    ram_total_mb: Math.round(os.totalmem() / 1048576),
    gpu_names: gpuNames,
  };
}

function collectGpu() {
  try {
    const out = run(
      "nvidia-smi --query-gpu=index,name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw --format=csv,noheader,nounits"
    );
    return out
      .split("\n")
      .filter((l) => l.trim())
      .map((line) => {
        const [index, name, util, memUsed, memTotal, temp, power] = line.split(",").map((s) => s.trim());
        return {
          index: Number(index),
          name,
          util_pct: Number(util),
          mem_used_mb: Number(memUsed),
          mem_total_mb: Number(memTotal),
          temp_c: Number(temp),
          power_w: Number(power),
        };
      });
  } catch {
    return []; // no nvidia-smi (e.g. Mac) — expected
  }
}

// ── Job state (tmux + log scraping) ─────────────────────────────────────────
function collectJobs() {
  const currentSessions = new Set();
  const jobs = [];

  let tmuxOut = "";
  try {
    tmuxOut = run("tmux ls");
  } catch {
    // tmux not running or not installed
    return { jobs, currentSessions };
  }

  for (const line of tmuxOut.split("\n")) {
    const match = line.match(/^([^:]+):/);
    if (!match) continue;
    const name = match[1].trim();
    currentSessions.add(name);

    const job = {
      name,
      project: inferProject(name),
      kind: inferKind(name),
      status: "running",
      progress: {},
    };

    // Read log tail + progress
    const logPath = path.join(LOG_DIR, `${name}.log`);
    if (fs.existsSync(logPath)) {
      try {
        const tail = readTail(logPath, 20);
        job.log_tail = tail; // PRIVATE — ingest routes to fleet_job_links
        job.progress = parseProgress(tail);
      } catch { /* log read failed, continue */ }
    }

    // Read rc_url sidecar
    const rcPath = path.join(LOG_DIR, `${name}.rc`);
    if (fs.existsSync(rcPath)) {
      try {
        const rcUrl = fs.readFileSync(rcPath, "utf-8").split("\n")[0].trim();
        if (rcUrl) job.rc_url = rcUrl; // PRIVATE — ingest routes to fleet_job_links
      } catch { /* rc read failed */ }
    }

    jobs.push(job);
  }

  return { jobs, currentSessions };
}

function inferKind(name) {
  if (name === "nav") return "nav";
  if (/^claude-\d{6}$/.test(name) || /^claude-/.test(name)) return "claude-session";
  if (name === "evolution" || name === "evo") return "evolution";
  return "other";
}

function inferProject(name) {
  // Cockpit convention: nav/evolution sessions are cellular-gaits
  if (["nav", "evolution", "evo"].includes(name)) return "cellular-gaits";
  return null;
}

function buildFinishedJob(name) {
  const logPath = path.join(LOG_DIR, `${name}.log`);
  let logTail = "";
  let status = "finished";

  if (fs.existsSync(logPath)) {
    try {
      logTail = readTail(logPath, 20);
      // Simple heuristic: if tail contains error/traceback/panic, mark as failed
      if (/\b(error|traceback|panic|fatal|exception)\b/i.test(logTail)) {
        status = "failed";
      }
    } catch { /* best effort */ }
  }

  return {
    name,
    project: inferProject(name),
    kind: inferKind(name),
    status,
    progress: parseProgress(logTail),
    ...(logTail ? { log_tail: logTail } : {}),
  };
}

// ── Progress parsing (best-effort) ──────────────────────────────────────────
function parseProgress(text) {
  if (!text) return {};
  const progress = {};

  // gen 150/500 or generation 150/500
  const genMatch = text.match(/gen(?:eration)?\s+(\d+)\s*[/]\s*(\d+)/i);
  if (genMatch) {
    progress.gens_done = Number(genMatch[1]);
    progress.gens_total = Number(genMatch[2]);
  }

  // best_fitness: 0.85 or best fit: 0.85 or best_fit=0.85
  const fitMatch = text.match(/best[_ ]?fit\w*[:= ]+(-?[\d.]+)/i);
  if (fitMatch) {
    progress.best_fitness = Number(fitMatch[1]);
  }

  return progress;
}

// ── Utilities ───────────────────────────────────────────────────────────────
function env(key, fallback) {
  return process.env[key] ?? fallback ?? "";
}

function resolveHome(p) {
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

function run(cmd) {
  return execSync(cmd, { encoding: "utf-8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"] }).trim();
}

function readTail(filePath, lines) {
  // Read last N lines without shelling out
  const buf = fs.readFileSync(filePath, "utf-8");
  const all = buf.split("\n");
  return all.slice(-lines - 1).join("\n").trim();
}

function log(msg) {
  console.log(`[fleet-reporter] ${new Date().toISOString()} ${msg}`);
}

async function postJSON(url, body, token) {
  const data = JSON.stringify(body);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: data,
  });
  const text = await res.text();
  return { status: res.status, body: text };
}
