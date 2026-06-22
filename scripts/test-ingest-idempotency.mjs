#!/usr/bin/env node
// Standalone simulation of the ingest finished-row idempotency + preserve-on-null
// logic (supabase/functions/ingest/index.ts §3). No network, no Supabase — it
// models fleet_jobs + fleet_job_links as in-memory maps and applies the SAME
// match/patch algorithm, then asserts the Phase D acceptance:
//   running → finished(hook, +last_message+rc_url) → finished(reporter, bare)
//   ⇒ exactly ONE job row, last_message + rc_url retained (not nulled),
//     hook's ended_at preserved.
//
// Run: node scripts/test-ingest-idempotency.mjs   (exit 0 = pass, 1 = fail)

const TERMINAL = new Set(["finished", "failed", "stopped"]);

// ── In-memory stand-ins for the two tables ───────────────────────────────────
let seq = 0;
const jobs = [];        // fleet_jobs rows
const links = new Map(); // job_id → fleet_job_links row

// Faithful re-implementation of ingest §3 for one job entry + one nowIso.
function ingestJob(machineId, j, nowIso) {
  const status = j.status ?? "running";
  const isTerminal = TERMINAL.has(status);

  // (a) live running row (≤1 per machine,name)
  const running = jobs.find(
    (r) => r.machine_id === machineId && r.name === j.name && r.status === "running",
  ) ?? null;

  let target = running;
  const matchedRunning = !!running;
  // (b) terminal fallback: most-recent row regardless of status
  if (!target && isTerminal) {
    const candidates = jobs
      .filter((r) => r.machine_id === machineId && r.name === j.name)
      .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
    target = candidates[0] ?? null;
  }

  // Row patch — preserve-on-null (only set meaningfully-provided columns).
  const row = { machine_id: machineId, name: j.name, status, updated_at: nowIso };
  if (j.project != null) row.project = j.project;
  if (j.kind !== undefined) row.kind = j.kind;
  if (j.progress && typeof j.progress === "object" && Object.keys(j.progress).length) {
    row.progress = j.progress;
  }
  if (j.started_at) row.started_at = j.started_at;
  if (j.exit_code !== undefined) row.exit_code = j.exit_code;
  if (j.ended_at !== undefined) row.ended_at = j.ended_at;
  else if (isTerminal && (matchedRunning || !target)) row.ended_at = nowIso;

  let jobId;
  if (target) {
    Object.assign(target, row); // UPDATE: omitted columns untouched
    jobId = target.id;
  } else {
    const fresh = {
      id: ++seq,
      project: null,
      kind: "other",
      progress: {},
      started_at: nowIso,
      ended_at: null,
      exit_code: null,
      ...row,
    };
    jobs.push(fresh);
    jobId = fresh.id;
  }

  // Private links — preserve-on-null upsert.
  const link = { job_id: jobId, updated_at: nowIso };
  for (const k of ["rc_url", "rc_qr", "cmd", "metrics_url", "log_tail", "last_message"]) {
    if (j[k] != null) link[k] = j[k];
  }
  if (Object.keys(link).length > 2) {
    const existing = links.get(jobId) ?? { job_id: jobId };
    links.set(jobId, { ...existing, ...link }); // omitted columns retained
  }
  return jobId;
}

// ── Scenario ──────────────────────────────────────────────────────────────────
const M = "machine-A";
const NAME = "claude-123456";

// 1) running heartbeat (reporter)
ingestJob(M, { name: NAME, project: "fleet", kind: "claude-session", status: "running", rc_url: "https://claude.ai/rc/abc" }, "2026-06-22T10:00:00Z");
// 2) finished from the SessionEnd hook — rich: last_message + ended_at + rc_url
ingestJob(M, { name: NAME, project: "fleet", kind: "claude-session", status: "finished", ended_at: "2026-06-22T10:05:00Z", last_message: "All tests pass. Branch pushed.", rc_url: "https://claude.ai/rc/abc" }, "2026-06-22T10:05:01Z");
// 3) finished from the reporter backstop — bare: no last_message, no rc_url
ingestJob(M, { name: NAME, project: null, kind: "claude-session", status: "finished", log_tail: "...done..." }, "2026-06-22T10:05:30Z");

// ── Assertions ──────────────────────────────────────────────────────────────
const mine = jobs.filter((r) => r.machine_id === M && r.name === NAME);
let ok = true;
function check(label, cond) {
  console.log(`${cond ? "PASS" : "FAIL"} — ${label}`);
  if (!cond) ok = false;
}

check("exactly ONE job row for (machine,name)", mine.length === 1);
const job = mine[0];
const link = links.get(job?.id);
check("the row is finished", job?.status === "finished");
check("hook's ended_at preserved (not re-stamped by reporter)", job?.ended_at === "2026-06-22T10:05:00Z");
check("project not nulled by bare reporter record", job?.project === "fleet");
check("last_message retained (not nulled)", link?.last_message === "All tests pass. Branch pushed.");
check("rc_url retained (not nulled)", link?.rc_url === "https://claude.ai/rc/abc");
check("reporter's log_tail also landed (real value update)", link?.log_tail === "...done...");
check("last_message lives ONLY in private links, never on the public row", job?.last_message === undefined);

// Bonus: a NEW running session reusing the same stable name must NOT resurrect
// the finished row — it inserts a fresh running row.
ingestJob(M, { name: NAME, status: "running" }, "2026-06-22T11:00:00Z");
const after = jobs.filter((r) => r.machine_id === M && r.name === NAME);
check("new running session inserts a 2nd row (no resurrection of finished)", after.length === 2);
check("the original finished row is untouched", after.find((r) => r.id === job.id)?.status === "finished");

console.log(ok ? "\n✅ idempotency + preserve-on-null verified" : "\n❌ assertions failed");
process.exit(ok ? 0 : 1);
