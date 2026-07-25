// Node test (zero-dep, node:test) for the MCv2 session-enrichment decision logic.
// Runs the SAME pure functions ingest/index.ts imports (session-logic.mjs), plus an
// in-memory simulator that mirrors index.ts's enrichSession + v1 fleet_jobs upsert,
// to walk the full race matrix from docs/SCHEMA_V2.md:
//   registered / unregistered  ×  reporter-first / hook-first / both / late-backstop
// asserting every path converges on exactly ONE session row with the right status
// and preserve-on-null private fields.
//
//   run:  node --test supabase/functions/ingest/test/session-logic.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  nextSessionStatus,
  pickSessionMatch,
  SESSION_NONTERMINAL,
} from "../session-logic.mjs";

// ── In-memory model of the two tables the ladder touches ──────────────────────
const TERMINAL_REC = new Set(["finished", "failed", "stopped"]);

function makeStore() {
  let clock = 0;
  let jid = 0;
  let sid = 0;
  const tick = () => ++clock;
  return {
    jobs: [],
    sessions: [],
    tick,
    newJobId: () => `job-${++jid}`,
    newSessionId: () => `sess-${++sid}`,
  };
}

// Mirror of v1's fleet_jobs upsert: a running row is transitioned in place; a
// terminal record with no running row falls back to the most-recent row; else
// insert. Yields a jobId stable per running→finished lifecycle, fresh per new one.
function upsertJob(store, rec) {
  const isTerminal = TERMINAL_REC.has(rec.status ?? "running");
  let target = store.jobs.find(
    (r) => r.machine_id === rec.machine_id && r.name === rec.name && r.status === "running",
  );
  const matchedRunning = !!target;
  if (!target && isTerminal) {
    const rows = store.jobs
      .filter((r) => r.machine_id === rec.machine_id && r.name === rec.name)
      .sort((a, b) => b.updated_at - a.updated_at);
    target = rows[0] ?? null;
  }
  const now = store.tick();
  if (target) {
    target.status = rec.status ?? "running";
    target.updated_at = now;
    return { jobId: target.id, matchedRunning };
  }
  const id = store.newJobId();
  store.jobs.push({
    id, machine_id: rec.machine_id, name: rec.name,
    status: rec.status ?? "running", updated_at: now,
  });
  return { jobId: id, matchedRunning: false };
}

// Mirror of index.ts enrichSession, using the shared pure decision functions.
function enrichSession(store, rec, jobId) {
  const isTerminal = TERMINAL_REC.has(rec.status ?? "running");
  const nonTerminal = (s) => SESSION_NONTERMINAL.has(s.status);
  const newest = (rows) => rows.sort((a, b) => b.updated_at - a.updated_at)[0] ?? null;

  const byJobId = store.sessions.find((s) => s.job_id === jobId) ?? null;
  const byName = newest(store.sessions.filter(
    (s) => s.machine_id === rec.machine_id && s.name === rec.name && nonTerminal(s),
  ));
  const byProjectBranch = (rec.project != null && rec.branch != null)
    ? newest(store.sessions.filter(
        (s) => s.machine_id === rec.machine_id && s.project === rec.project &&
               s.branch === rec.branch && nonTerminal(s)))
    : null;

  const { row } = pickSessionMatch({ byJobId, byName, byProjectBranch });
  const now = store.tick();

  const carry = (dst) => {
    for (const k of ["project", "repo", "branch", "worktree", "last_message", "rc_url", "pr_url"]) {
      if (rec[k] != null) dst[k] = rec[k];
    }
  };

  if (row) {
    const next = nextSessionStatus(row.status, isTerminal);
    if (next === "running" && !row.started_at) row.started_at = now;
    if (next === "done" && !row.ended_at) row.ended_at = now;
    row.status = next;
    row.job_id = jobId;
    row.name = rec.name;
    row.updated_at = now;
    carry(row);
    return row;
  }

  const ins = {
    id: store.newSessionId(), wave_id: null, machine_id: rec.machine_id, job_id: jobId,
    name: rec.name, status: isTerminal ? "done" : "running",
    started_at: now, ended_at: isTerminal ? now : null, updated_at: now,
  };
  carry(ins);
  store.sessions.push(ins);
  return ins;
}

function registerPlanned(store, { machine_id, name, project, branch, wave_id = "wave-1" }) {
  const now = store.tick();
  const row = {
    id: store.newSessionId(), wave_id, machine_id, job_id: null,
    name, project, branch, status: "planned",
    started_at: null, ended_at: null, updated_at: now,
  };
  store.sessions.push(row);
  return row;
}

// One telemetry record → upsertJob → enrichSession, as ingest does per job.
function ingest(store, rec) {
  const { jobId } = upsertJob(store, rec);
  return enrichSession(store, rec, jobId);
}

const M = "machine-A";
const running = (over = {}) => ({ machine_id: M, name: "claude-1", kind: "claude-session", status: "running", project: "portfolio", branch: "feat/x", ...over });
const finished = (over = {}) => ({ machine_id: M, name: "claude-1", kind: "claude-session", status: "finished", project: "portfolio", branch: "feat/x", last_message: "done!", rc_url: "https://rc/1", pr_url: "https://pr/1", ...over });

// ── Pure transition table ─────────────────────────────────────────────────────
test("nextSessionStatus transition table", () => {
  assert.equal(nextSessionStatus("planned", false), "running");
  assert.equal(nextSessionStatus("planned", true), "done");
  assert.equal(nextSessionStatus("running", false), "running");
  assert.equal(nextSessionStatus("running", true), "done");
  assert.equal(nextSessionStatus("waiting", true), "done");
  assert.equal(nextSessionStatus("done", false), "done", "stray running never reopens done");
  assert.equal(nextSessionStatus("done", true), "done");
  for (const op of ["reviewed", "merged", "rejected"]) {
    assert.equal(nextSessionStatus(op, true), op, `${op} is sticky vs terminal record`);
    assert.equal(nextSessionStatus(op, false), op, `${op} is sticky vs running record`);
  }
  assert.equal(nextSessionStatus("lost", false), "lost", "stray running never reopens lost");
  assert.equal(nextSessionStatus("lost", true), "done", "a genuine late terminal record flips lost -> done");
});

test("SESSION_NONTERMINAL excludes lost (telemetry-terminal like done)", () => {
  assert.ok(!SESSION_NONTERMINAL.has("lost"));
  assert.ok(!SESSION_NONTERMINAL.has("done"));
});

test("pickSessionMatch obeys job_id > name > project+branch > create", () => {
  assert.equal(pickSessionMatch({ byJobId: { id: "j" }, byName: { id: "n" } }).via, "job_id");
  assert.equal(pickSessionMatch({ byName: { id: "n" }, byProjectBranch: { id: "b" } }).via, "machine_name");
  assert.equal(pickSessionMatch({ byProjectBranch: { id: "b" } }).via, "machine_project_branch");
  assert.equal(pickSessionMatch({}).via, "create_ungrouped");
});

// ── Race matrix: REGISTERED (a launcher created a `planned` session) ──────────
test("registered · reporter-first then hook", () => {
  const s = makeStore();
  const planned = registerPlanned(s, { machine_id: M, name: "claude-1", project: "portfolio", branch: "feat/x" });
  ingest(s, running());
  ingest(s, finished());
  assert.equal(s.sessions.length, 1, "no duplicate");
  const row = s.sessions[0];
  assert.equal(row.id, planned.id, "same planned row enriched, not a new one");
  assert.equal(row.status, "done");
  assert.equal(row.last_message, "done!");
  assert.equal(row.pr_url, "https://pr/1");
  assert.ok(row.wave_id, "stays grouped under its wave");
});

test("registered · hook-first, then late bare-reporter backstop (no dup, no clobber)", () => {
  const s = makeStore();
  const planned = registerPlanned(s, { machine_id: M, name: "claude-1", project: "portfolio", branch: "feat/x" });
  ingest(s, finished());                                   // hook arrives first
  ingest(s, { machine_id: M, name: "claude-1", kind: "claude-session", status: "finished" }); // bare backstop
  assert.equal(s.sessions.length, 1);
  const row = s.sessions[0];
  assert.equal(row.id, planned.id);
  assert.equal(row.status, "done");
  assert.equal(row.last_message, "done!", "backstop must not null the hook's message");
  assert.equal(row.pr_url, "https://pr/1", "backstop must not null the hook's pr_url");
});

test("registered · Terminal.app fallback matches on (machine,project,branch)", () => {
  const s = makeStore();
  // launcher registered under the branch handle; live JOB_NAME is claude-<sid8>.
  const planned = registerPlanned(s, { machine_id: M, name: "feat/x-planned", project: "portfolio", branch: "feat/x" });
  ingest(s, running({ name: "claude-ab12cd34" }));
  assert.equal(s.sessions.length, 1, "matched via branch, not landed ungrouped");
  assert.equal(s.sessions[0].id, planned.id);
  assert.equal(s.sessions[0].status, "running");
  assert.equal(s.sessions[0].name, "claude-ab12cd34", "name updated to the live session name");
  ingest(s, finished({ name: "claude-ab12cd34" }));
  assert.equal(s.sessions.length, 1);
  assert.equal(s.sessions[0].status, "done");
});

// ── Race matrix: UNREGISTERED (out-of-launcher dispatch) ──────────────────────
test("unregistered · reporter-first then hook creates one ungrouped row", () => {
  const s = makeStore();
  ingest(s, running());
  assert.equal(s.sessions.length, 1);
  assert.equal(s.sessions[0].wave_id, null, "ungrouped");
  assert.equal(s.sessions[0].status, "running");
  ingest(s, finished());
  assert.equal(s.sessions.length, 1, "hook binds via job_id, no dup");
  assert.equal(s.sessions[0].status, "done");
  assert.equal(s.sessions[0].pr_url, "https://pr/1");
});

test("unregistered · hook-only (finish, no prior running) creates one done row", () => {
  const s = makeStore();
  ingest(s, finished());
  ingest(s, { machine_id: M, name: "claude-1", kind: "claude-session", status: "finished" }); // late backstop
  assert.equal(s.sessions.length, 1);
  assert.equal(s.sessions[0].status, "done");
  assert.equal(s.sessions[0].last_message, "done!");
});

// ── Name reuse across waves must not resurrect a terminal session ─────────────
test("reused branch name after a done session starts a fresh session", () => {
  const s = makeStore();
  ingest(s, running());
  ingest(s, finished());                       // session #1 → done
  assert.equal(s.sessions[0].status, "done");
  ingest(s, running());                        // same name, new lifecycle
  assert.equal(s.sessions.length, 2, "a new running record spawns a new session, not reopen the done one");
  assert.equal(s.sessions[1].status, "running");
});

// ── Operator decision is not clobbered by a straggler telemetry record ────────
test("operator-terminal session is sticky against a late record", () => {
  const s = makeStore();
  ingest(s, running());
  ingest(s, finished());
  s.sessions[0].status = "merged";             // operator merged it in the cockpit
  ingest(s, { machine_id: M, name: "claude-1", kind: "claude-session", status: "finished" });
  assert.equal(s.sessions[0].status, "merged", "merged stays merged");
});

// ── Staleness sweep interop (the pg_cron sweeper flips a row to `lost` directly in
//    Postgres — these tests simulate that DB-side transition, then exercise ingest's
//    reaction to later telemetry, since the sweep itself isn't pure JS to unit-test).
//
// IMPORTANT precondition modeled here: the sweep's own eligibility predicate only
// marks a `running` session `lost` when its linked fleet_jobs row is no longer live
// (see the migration), and the sweep closes that fleet_jobs row to `stopped` in the
// same pass. This matters because v1's job upsert (untouched, out of scope) reuses
// an EXISTING row only while its status is `running`; if the sweep left the job row
// at `running` forever, the next real telemetry for the same (machine,name) would
// silently rebind to the dead job_id and land right back on the lost session via
// ingest's job_id anchor (which has no status filter) — breaking the "a later real
// record must start a fresh session" requirement. Closing the job row preserves
// v1's own job_id-freshness guarantee, so `closeJob` below is not test scaffolding
// convenience, it's asserting a real invariant the migration must uphold.
function closeJob(store, jobId) {
  const j = store.jobs.find((r) => r.id === jobId);
  if (j) j.status = "stopped";
}

test("reused (machine,name) after a lost session starts a fresh session, not a reopen", () => {
  const s = makeStore();
  const planned = registerPlanned(s, { machine_id: M, name: "claude-1", project: "portfolio", branch: "feat/x" });
  ingest(s, running());
  assert.equal(s.sessions[0].id, planned.id);
  const deadJobId = s.sessions[0].job_id;
  s.sessions[0].status = "lost";               // pg_cron sweep: abrupt kill, no SessionEnd ever
  closeJob(s, deadJobId);                      // ...and closes the linked job (see note above)
  ingest(s, running());                        // same (machine,name) starts a new lifecycle
  assert.equal(s.sessions.length, 2, "a new running record spawns a fresh session, does not reopen lost");
  assert.equal(s.sessions[0].status, "lost", "the lost row is untouched");
  assert.equal(s.sessions[1].status, "running");
  assert.notEqual(s.sessions[1].id, planned.id);
  assert.notEqual(s.sessions[1].job_id, deadJobId, "fresh lifecycle gets a fresh job_id, not the dead one");
});

test("Terminal.app fallback (machine,project,branch) also skips a lost row, creates fresh", () => {
  const s = makeStore();
  const planned = registerPlanned(s, { machine_id: M, name: "feat/x-planned", project: "portfolio", branch: "feat/x" });
  ingest(s, running({ name: "claude-ab12cd34" }));
  assert.equal(s.sessions[0].id, planned.id);
  closeJob(s, s.sessions[0].job_id);
  s.sessions[0].status = "lost";
  ingest(s, running({ name: "claude-ef56gh78" })); // a fresh Terminal.app session, same project+branch
  assert.equal(s.sessions.length, 2, "does not match the lost row via the branch fallback tier");
  assert.equal(s.sessions[1].wave_id, null, "fresh session lands ungrouped, not bound to the old wave");
});

test("late hook record after a sweep-marked lost session still flips it to done (name-match terminal fallback)", () => {
  const s = makeStore();
  ingest(s, running());                        // job_id bound on first touch
  const deadJobId = s.sessions[0].job_id;
  s.sessions[0].status = "lost";               // sweep gave up on it (job never reported terminal in time)
  closeJob(s, deadJobId);
  ingest(s, finished());                       // the hook's SessionEnd finally lands for the same name
  assert.equal(s.sessions.length, 1, "v1's terminal-fallback (match by name when isTerminal) reunites with the closed job — no duplicate");
  assert.equal(s.sessions[0].job_id, deadJobId, "same job_id, now closed out by the terminal record instead of the sweep");
  assert.equal(s.sessions[0].status, "done", "genuine late terminal record flips lost -> done");
  assert.equal(s.sessions[0].last_message, "done!");
});

test("a race: a non-terminal record still carrying the dead job_id never reopens a lost row", () => {
  // Not reachable via the normal (machine,name)-keyed upsert path once the sweep has
  // closed the job (see the tests above) — this exercises the job_id anchor directly
  // (e.g. a replayed/duplicate request racing the sweep) to prove nextSessionStatus's
  // defense-in-depth: `lost` is sticky against a non-terminal record, mirroring `done`.
  const s = makeStore();
  ingest(s, running());
  const deadJobId = s.sessions[0].job_id;
  s.sessions[0].status = "lost";
  enrichSession(s, running(), deadJobId);      // forces the tier-1 job_id anchor directly
  assert.equal(s.sessions.length, 1, "still the same row via job_id");
  assert.equal(s.sessions[0].status, "lost", "a non-terminal record never reopens lost, mirrors done");
});
