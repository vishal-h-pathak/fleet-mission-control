#!/usr/bin/env node
// Fleet Mission Control — Reporter agent (P0 + P1)
// Standalone Node heartbeat daemon. Zero npm deps.
// Usage: node index.mjs [--dry-run] [--once] [--import-log <name>]
//   --import-log <name>  Parse the ENTIRE $LOG_DIR/<name>.log, emit every generation's
//                        metric point (chunked) for that job, mark it finished, then exit.
//                        Backfills a finished run's full fitness curve into fleet_job_metrics.

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

// Max metric points to attach per job per heartbeat; the rest flush on later ticks.
const METRICS_CAP = 200;

const DRY_RUN = process.argv.includes("--dry-run");
const ONCE = process.argv.includes("--once");
const IMPORT_LOG = argValue("--import-log");

// Highest generation already sent per job (in-memory; seeded from $LOG_DIR/<name>.cursor).
const sentCursor = new Map();

// ── Startup ─────────────────────────────────────────────────────────────────
if (!DRY_RUN && !FLEET_TOKEN) {
  console.error("FATAL: FLEET_TOKEN is required (unless --dry-run).");
  process.exit(1);
}

const specs = collectSpecs();
let prevSessions = new Set(); // track tmux sessions for finished-job detection
let firstTick = true;

log(`reporter starting — machine=${MACHINE_NAME} interval=${INTERVAL_S}s dry=${DRY_RUN} once=${ONCE}`);

if (IMPORT_LOG) {
  runImportLog(IMPORT_LOG); // one-shot backfill, then exit
} else {
  tick(); // first heartbeat immediately
  if (!ONCE && !DRY_RUN) {
    setInterval(tick, INTERVAL_S * 1000);
  }
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
      machine: machineDescriptor(),
      heartbeat,
      jobs,
    };

    if (DRY_RUN) {
      console.log(JSON.stringify(payload, null, 2));
      process.exit(0);
    }

    const res = await postJSON(INGEST_URL, payload, FLEET_TOKEN);
    if (res.status === 200) {
      persistCursors(payload); // advance per-job gen cursors only on a confirmed write
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

    // Read log tail + progress + new metric points (single read of the full log)
    const logPath = path.join(LOG_DIR, `${name}.log`);
    if (fs.existsSync(logPath)) {
      try {
        const buf = fs.readFileSync(logPath, "utf-8");
        const tail = tailOf(buf, 20);
        job.log_tail = tail; // PRIVATE — ingest routes to fleet_job_links
        job.progress = parseProgress(tail);
        const pts = newMetricsFor(name, buf); // only generations past the cursor, capped
        if (pts.length) job.metrics = pts; // PUBLIC — ingest routes to fleet_job_metrics
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
  let pts = [];

  if (fs.existsSync(logPath)) {
    try {
      const buf = fs.readFileSync(logPath, "utf-8");
      logTail = tailOf(buf, 20);
      // Simple heuristic: if tail contains error/traceback/panic, mark as failed
      if (/\b(error|traceback|panic|fatal|exception)\b/i.test(logTail)) {
        status = "failed";
      }
      pts = newMetricsFor(name, buf); // flush any generations not yet sent
    } catch { /* best effort */ }
  }

  return {
    name,
    project: inferProject(name),
    kind: inferKind(name),
    status,
    progress: parseProgress(logTail),
    ...(logTail ? { log_tail: logTail } : {}),
    ...(pts.length ? { metrics: pts } : {}),
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

// ── Metric points (per-generation fitness time-series) ───────────────────────
// Scans every line and returns one point per generation that also reports a
// fitness value: { gen, best_fitness?, mean_fitness? }. Deduped by gen (last
// line for a gen wins), sorted ascending. Feeds public fleet_job_metrics.
function parseMetrics(text) {
  if (!text) return [];
  const byGen = new Map();
  for (const line of text.split("\n")) {
    // gen / generation followed by an integer (optionally "N/total")
    const genMatch = line.match(/\bgen(?:eration)?\b[:=#\s]*(\d+)/i);
    if (!genMatch) continue;
    const gen = Number(genMatch[1]);

    const bestMatch = line.match(/best[_ ]?fit\w*[:= ]+(-?[\d.]+)/i);
    const meanMatch = line.match(/mean[_ ]?fit\w*[:= ]+(-?[\d.]+)/i);
    if (!bestMatch && !meanMatch) continue; // a gen line with no fitness isn't a point

    const pt = { gen };
    if (bestMatch) pt.best_fitness = Number(bestMatch[1]);
    if (meanMatch) pt.mean_fitness = Number(meanMatch[1]);
    byGen.set(gen, pt);
  }
  return [...byGen.values()].sort((a, b) => a.gen - b.gen);
}

// New (un-sent) metric points for a job: generations past the cursor, capped.
function newMetricsFor(name, buf) {
  const all = parseMetrics(buf);
  if (!all.length) return [];
  const cur = getCursor(name);
  return all.filter((p) => p.gen > cur).slice(0, METRICS_CAP);
}

// ── Gen cursor (in-memory + optional $LOG_DIR/<name>.cursor) ──────────────────
function cursorPath(name) {
  return path.join(LOG_DIR, `${name}.cursor`);
}

function getCursor(name) {
  if (sentCursor.has(name)) return sentCursor.get(name);
  let v = -1; // -1 → nothing sent yet; gen 0 is still "new"
  try {
    const n = parseInt(fs.readFileSync(cursorPath(name), "utf-8").trim(), 10);
    if (Number.isFinite(n)) v = n;
  } catch { /* no cursor file yet */ }
  sentCursor.set(name, v);
  return v;
}

function setCursor(name, gen) {
  sentCursor.set(name, gen);
  try {
    fs.writeFileSync(cursorPath(name), String(gen));
  } catch { /* best effort; in-memory cursor still advances */ }
}

// After a confirmed write, advance each job's cursor to the highest gen we sent.
function persistCursors(payload) {
  for (const j of payload.jobs ?? []) {
    if (Array.isArray(j.metrics) && j.metrics.length) {
      const maxGen = j.metrics.reduce((m, p) => (p.gen > m ? p.gen : m), getCursor(j.name));
      setCursor(j.name, maxGen);
    }
  }
}

// ── One-shot backfill: --import-log <name> ───────────────────────────────────
async function runImportLog(name) {
  const logPath = path.join(LOG_DIR, `${name}.log`);
  if (!fs.existsSync(logPath)) {
    log(`import: no log at ${logPath}`);
    process.exit(1);
  }
  const buf = fs.readFileSync(logPath, "utf-8");
  const points = parseMetrics(buf); // entire log, every generation
  const tail = tailOf(buf, 20);
  const finalStatus = /\b(error|traceback|panic|fatal|exception)\b/i.test(tail) ? "failed" : "finished";
  const base = {
    name,
    project: inferProject(name),
    kind: inferKind(name),
    progress: parseProgress(tail),
  };

  // Chunk so a long run flushes in payload-sane batches. All chunks upsert the
  // SAME job by (machine,name) as status:"running" so ingest matches one row;
  // only the final chunk closes it. (ingest matches existing jobs by the
  // running partial-unique key, so closing early would split the curve.)
  const chunks = [];
  for (let i = 0; i < points.length; i += METRICS_CAP) chunks.push(points.slice(i, i + METRICS_CAP));
  if (!chunks.length) chunks.push([]); // still upsert the finished job even with no points

  log(`import: ${name} — ${points.length} metric point(s) across ${chunks.length} heartbeat(s)`);

  for (let i = 0; i < chunks.length; i++) {
    const isLast = i === chunks.length - 1;
    const job = { ...base, status: isLast ? finalStatus : "running", metrics: chunks[i] };
    const payload = { machine: machineDescriptor(), jobs: [job] }; // no heartbeat — backfill only

    if (DRY_RUN) {
      console.log(JSON.stringify(payload, null, 2));
      continue;
    }
    const res = await postJSON(INGEST_URL, payload, FLEET_TOKEN);
    if (res.status !== 200) {
      log(`import chunk ${i + 1}/${chunks.length} FAILED ${res.status}: ${res.body}`);
      process.exit(1);
    }
    log(`import chunk ${i + 1}/${chunks.length} ok (${chunks[i].length} points, status=${job.status})`);
  }

  log(`import done: ${name}`);
  process.exit(0);
}

// ── Utilities ───────────────────────────────────────────────────────────────
function machineDescriptor() {
  return { os: os.platform(), arch: os.arch(), specs, agent_version: AGENT_VERSION };
}

// Value following a flag in argv, e.g. argValue("--import-log") → "nav".
function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

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

function tailOf(buf, lines) {
  // Last N lines of an already-read buffer (no extra file read)
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
