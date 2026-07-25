// Node test (zero-dep, node:test) for the MCv2 wave-dispatch launch state machine.
// Runs the SAME pure functions dispatch/index.ts imports (dispatch-logic.mjs), plus
// an in-memory simulator that mirrors index.ts's poll/claim/ack handlers — including
// the two-phase claim (precheck, then conditional update) that makes the double-claim
// race expressible — to walk the launch race matrix in docs/SCHEMA_V2.md:
//   double-claim · claim-after-abandon · partial launch · late ack · wrong machine
//
//   run:  node --test supabase/functions/dispatch/test/dispatch-logic.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ackPrecheck,
  ackSessionPatch,
  claimPrecheck,
  isWaveLaunchable,
  nextWaveStatusOnClaim,
  POLL_FORBIDDEN_FIELDS,
  projectPollSession,
  projectPollWave,
  waveLaunchOutcome,
  WAVE_STATUSES_V2,
} from "../dispatch-logic.mjs";
// Cross-check against the ingest module: the register block must not be able to arm
// a wave. Read-only assertion — this test owns no part of ingest.
import { WAVE_STATUSES as REGISTERABLE_WAVE_STATUSES } from "../../ingest/session-logic.mjs";

// ── In-memory model of the two tables the dispatch function touches ───────────
const MACH_A = "machine-A";
const MACH_B = "machine-B";

function makeStore() {
  return { waves: [], sessions: [], clock: 0, wid: 0, sid: 0 };
}
const tick = (st) => `t${++st.clock}`;

function addWave(st, { status = "confirmed", project_id = "proj-1", name = "wave" } = {}) {
  const w = {
    id: `wave-${++st.wid}`, project_id, name, status,
    confirmed_at: status === "confirmed" ? tick(st) : null,
    confirmed_by: status === "confirmed" ? "operator@example.com" : null,
    launch_error: null, updated_at: tick(st),
  };
  st.waves.push(w);
  return w;
}

function addSession(st, wave, { machine_id = MACH_A, name, status = "planned", ...rest } = {}) {
  const s = {
    id: `sess-${++st.sid}`, wave_id: wave?.id ?? null, machine_id,
    name: name ?? `feat/x${st.sid}`, status,
    project: "portfolio", repo: "owner/portfolio", branch: `feat/x${st.sid}`,
    worktree: "../pf-wt/x", model: "sonnet", prompt_ref: "ops/prompts/PROMPT_x.md",
    directive: "SECRET free-text directive — must never reach an agent",
    claimed_at: null, claimed_by: null, launched_at: null, launch_error: null,
    updated_at: tick(st), ...rest,
  };
  st.sessions.push(s);
  return s;
}

const waveOf = (st, s) => st.waves.find((w) => w.id === s?.wave_id) ?? null;
const sessionsOfWave = (st, waveId) => st.sessions.filter((s) => s.wave_id === waveId);
const joined = (st, s) => (s ? { ...s, wave_status: waveOf(st, s)?.status ?? null } : null);

// Mirror of index.ts `poll`: this machine's unclaimed, still-planned sessions on
// launchable waves, projected through the field allowlist.
function poll(st, machineId) {
  return st.sessions
    .filter((s) =>
      s.machine_id === machineId &&
      s.claimed_at == null &&
      s.status === "planned" &&
      isWaveLaunchable(waveOf(st, s)?.status))
    .map((s) => ({ wave: projectPollWave(waveOf(st, s)), session: projectPollSession(s) }));
}

// Mirror of index.ts's conditional claim UPDATE:
//   update ... where id=$1 and machine_id=$auth and claimed_at is null and status='planned'
// Returns the number of rows the update matched — 1 = won, 0 = lost.
function conditionalClaim(st, machineId, sessionId, now) {
  const s = st.sessions.find((x) =>
    x.id === sessionId && x.machine_id === machineId &&
    x.claimed_at == null && x.status === "planned");
  if (!s) return 0;
  s.claimed_at = now;
  s.claimed_by = machineId;
  s.updated_at = now;
  return 1;
}

function releaseClaim(st, sessionId, machineId, now) {
  const s = st.sessions.find((x) => x.id === sessionId && x.claimed_by === machineId);
  if (s) { s.claimed_at = null; s.claimed_by = null; s.updated_at = now; }
}

// Mirror of index.ts `claim`. `pre` lets a test capture the precheck BEFORE a rival
// mutates the store — that interleaving is precisely the double-claim race.
function claim(st, machineId, sessionId, { pre } = {}) {
  const check = pre ?? claimPrecheck({
    session: joined(st, st.sessions.find((x) => x.id === sessionId)),
    machineId,
  });
  if (!check.ok) return { won: false, reason: check.reason };

  const now = tick(st);
  if (conditionalClaim(st, machineId, sessionId, now) !== 1) {
    return { won: false, reason: "already_claimed" };
  }

  // Compensating re-check: the wave can be abandoned BETWEEN precheck and update
  // (PostgREST can't join a wave predicate into the session UPDATE). If it was,
  // release the claim and stand down — never launch off an abandoned wave.
  const w = waveOf(st, st.sessions.find((x) => x.id === sessionId));
  if (!isWaveLaunchable(w?.status)) {
    releaseClaim(st, sessionId, machineId, now);
    return { won: false, reason: "wave_not_launchable" };
  }

  const next = nextWaveStatusOnClaim(w.status);
  if (next !== w.status) { w.status = next; w.updated_at = now; }
  return { won: true };
}

// Mirror of index.ts `ack`.
function ack(st, machineId, sessionId, ok, error) {
  const s = st.sessions.find((x) => x.id === sessionId) ?? null;
  const check = ackPrecheck({ session: s, machineId });
  if (!check.ok) return { ok: false, reason: check.reason };

  const now = tick(st);
  Object.assign(s, ackSessionPatch({ session: s, ok, error, nowIso: now }));

  const w = waveOf(st, s);
  const outcome = waveLaunchOutcome({
    waveStatus: w?.status,
    sessions: sessionsOfWave(st, s.wave_id),
  });
  if (outcome && w) {
    w.status = outcome.status;
    w.launch_error = outcome.launch_error;
    w.updated_at = now;
  }
  return { ok: true };
}

// ── Pure lifecycle table ──────────────────────────────────────────────────────
test("only confirmed/launching are launchable", () => {
  assert.ok(isWaveLaunchable("confirmed"));
  assert.ok(isWaveLaunchable("launching"));
  for (const s of ["draft", "dispatched", "reviewing", "done", "abandoned"]) {
    assert.ok(!isWaveLaunchable(s), `${s} must not be pollable/claimable`);
  }
  // every launchable status is a real status
  for (const s of ["confirmed", "launching"]) assert.ok(WAVE_STATUSES_V2.includes(s));
});

test("nextWaveStatusOnClaim only arms confirmed -> launching", () => {
  assert.equal(nextWaveStatusOnClaim("confirmed"), "launching");
  assert.equal(nextWaveStatusOnClaim("launching"), "launching", "idempotent");
  for (const s of ["draft", "dispatched", "reviewing", "done", "abandoned"]) {
    assert.equal(nextWaveStatusOnClaim(s), s, `a claim must never resurrect ${s}`);
  }
});

// SECURITY INVARIANT (a): `confirmed` is the sole execution trigger, and a machine
// token must not be able to set it. ingest's register block accepts a wave status
// from its own list — that list must never grow a launchable status.
test("the ingest register block cannot arm a wave (invariant a)", () => {
  for (const s of ["confirmed", "launching"]) {
    assert.ok(
      !REGISTERABLE_WAVE_STATUSES.includes(s),
      `register must not accept wave status '${s}' — only the authed cockpit route may arm work`,
    );
  }
});

// SECURITY INVARIANT (c): directives are never transported to agents.
test("poll projection never carries the directive or any sensitive field (invariant c)", () => {
  const st = makeStore();
  const w = addWave(st);
  const s = addSession(st, w, {
    last_message: "final message", rc_url: "https://rc/1", pr_url: "https://pr/1",
  });
  const [work] = poll(st, MACH_A);
  for (const k of POLL_FORBIDDEN_FIELDS) {
    assert.ok(!(k in work.session), `poll response must not carry '${k}'`);
  }
  assert.equal(Object.values(work.session).includes(s.directive), false);
  // ...while still carrying everything the agent legitimately needs to launch.
  assert.deepEqual(Object.keys(work.session).sort(),
    ["branch", "id", "model", "name", "project", "prompt_ref", "repo", "worktree"]);
  assert.equal(work.session.branch, s.branch);
  assert.equal(work.wave.id, w.id);
});

test("a column added to fleet_sessions later cannot leak through poll (allowlist, not denylist)", () => {
  const st = makeStore();
  const w = addWave(st);
  addSession(st, w, { some_future_secret_column: "leak-me" });
  const [work] = poll(st, MACH_A);
  assert.ok(!("some_future_secret_column" in work.session));
});

// ── Race: two agents claim the same session ──────────────────────────────────
test("double-claim race: both preflight clean, exactly one wins", () => {
  const st = makeStore();
  const w = addWave(st, { status: "confirmed" });
  const s = addSession(st, w, { machine_id: MACH_A });

  // Both callers read the session BEFORE either writes — the real interleaving.
  const preA = claimPrecheck({ session: joined(st, s), machineId: MACH_A });
  const preB = claimPrecheck({ session: joined(st, s), machineId: MACH_A });
  assert.ok(preA.ok && preB.ok, "both prechecks pass — the precheck is not the lock");

  const first = claim(st, MACH_A, s.id, { pre: preA });
  const second = claim(st, MACH_A, s.id, { pre: preB });

  assert.deepEqual(first, { won: true });
  assert.deepEqual(second, { won: false, reason: "already_claimed" },
    "the conditional UPDATE, not the precheck, is what serializes the claim");
  assert.equal(s.claimed_by, MACH_A);
  assert.equal(w.status, "launching", "the winner arms the wave");
  assert.equal(st.sessions.filter((x) => x.claimed_at != null).length, 1,
    "one session, one claim — never a double launch");
});

test("a re-poll after a claim never re-offers the claimed session", () => {
  const st = makeStore();
  const w = addWave(st);
  const s = addSession(st, w);
  assert.equal(poll(st, MACH_A).length, 1);
  claim(st, MACH_A, s.id);
  assert.equal(poll(st, MACH_A).length, 0, "claimed work is gone from the poll set");
});

// ── Race: the wave is abandoned mid-flight ───────────────────────────────────
test("claim-after-abandon is refused outright", () => {
  const st = makeStore();
  const w = addWave(st, { status: "confirmed" });
  const s = addSession(st, w);
  w.status = "abandoned";                       // operator hit the kill switch

  assert.deepEqual(claim(st, MACH_A, s.id), { won: false, reason: "wave_not_launchable" });
  assert.equal(s.claimed_at, null, "an abandoned wave's session stays unclaimed");
  assert.equal(w.status, "abandoned", "a refused claim never moves the wave");
  assert.equal(poll(st, MACH_A).length, 0, "nor is it pollable");
});

test("abandon landing BETWEEN precheck and update releases the claim (compensating re-check)", () => {
  const st = makeStore();
  const w = addWave(st, { status: "confirmed" });
  const s = addSession(st, w);

  const pre = claimPrecheck({ session: joined(st, s), machineId: MACH_A });  // wave still confirmed
  assert.ok(pre.ok);
  w.status = "abandoned";                        // ...operator abandons it right now
  const res = claim(st, MACH_A, s.id, { pre });

  assert.deepEqual(res, { won: false, reason: "wave_not_launchable" });
  assert.equal(s.claimed_at, null, "the claim is released, not left stranded");
  assert.equal(s.claimed_by, null);
  assert.equal(w.status, "abandoned");
});

test("a draft wave is inert — confirmation is the only trigger (invariant a)", () => {
  const st = makeStore();
  const w = addWave(st, { status: "draft" });
  const s = addSession(st, w);
  assert.equal(poll(st, MACH_A).length, 0);
  assert.deepEqual(claim(st, MACH_A, s.id), { won: false, reason: "wave_not_launchable" });
});

// ── Wrong-machine isolation (invariant b) ────────────────────────────────────
test("wrong-machine isolation: poll and claim are both scoped to the authed machine", () => {
  const st = makeStore();
  const w = addWave(st);
  const mine = addSession(st, w, { machine_id: MACH_A, name: "feat/mine" });
  const theirs = addSession(st, w, { machine_id: MACH_B, name: "feat/theirs" });

  const seenByA = poll(st, MACH_A);
  assert.equal(seenByA.length, 1);
  assert.equal(seenByA[0].session.id, mine.id, "A never sees B's work");
  assert.equal(poll(st, MACH_B).length, 1);
  assert.equal(poll(st, MACH_B)[0].session.id, theirs.id);

  // B tries to claim A's session by id anyway.
  const res = claim(st, MACH_B, mine.id);
  assert.deepEqual(res, { won: false, reason: "unknown_session" },
    "a cross-machine claim is indistinguishable from a nonexistent one — no id probing");
  assert.equal(mine.claimed_at, null, "and it is not claimed");
  assert.equal(w.status, "confirmed", "nor did the refused claim arm the wave");
});

test("wrong-machine ack is refused, and an unclaimed session cannot be acked", () => {
  const st = makeStore();
  const w = addWave(st);
  const mine = addSession(st, w, { machine_id: MACH_A });
  claim(st, MACH_A, mine.id);

  assert.deepEqual(ack(st, MACH_B, mine.id, true), { ok: false, reason: "unknown_session" });
  assert.equal(mine.launched_at, null, "B's ack changed nothing");

  const unclaimed = addSession(st, w, { machine_id: MACH_A, name: "feat/unclaimed" });
  assert.deepEqual(ack(st, MACH_A, unclaimed.id, true), { ok: false, reason: "not_claimed" },
    "only the machine that won the claim may ack it");
});

// ── Launch completion ────────────────────────────────────────────────────────
test("happy path: all sessions launch -> wave dispatched, no launch_error", () => {
  const st = makeStore();
  const w = addWave(st);
  const ss = [addSession(st, w), addSession(st, w), addSession(st, w)];

  for (const s of ss) assert.deepEqual(claim(st, MACH_A, s.id), { won: true });
  assert.equal(w.status, "launching");

  ack(st, MACH_A, ss[0].id, true);
  assert.equal(w.status, "launching", "still launching while sessions are outstanding");
  ack(st, MACH_A, ss[1].id, true);
  assert.equal(w.status, "launching");
  ack(st, MACH_A, ss[2].id, true);
  assert.equal(w.status, "dispatched");
  assert.equal(w.launch_error, null);
  assert.ok(ss.every((s) => s.launched_at != null));
});

test("partial launch: one session fails -> wave still completes, failure recorded at both levels", () => {
  const st = makeStore();
  const w = addWave(st);
  const [a, b, c] = [addSession(st, w), addSession(st, w), addSession(st, w)];
  for (const s of [a, b, c]) claim(st, MACH_A, s.id);

  ack(st, MACH_A, a.id, true);
  ack(st, MACH_A, b.id, false, "tmux: session already exists");
  assert.equal(w.status, "launching", "one still outstanding");
  ack(st, MACH_A, c.id, true);

  assert.equal(w.status, "dispatched", "a failed launch does not hang the wave");
  assert.equal(w.launch_error, "1/3 sessions failed to launch");
  assert.equal(b.launch_error, "tmux: session already exists");
  assert.equal(b.launched_at, null);
  assert.ok(a.launched_at && c.launched_at);
  assert.equal(b.claimed_at != null, true,
    "a failed session KEEPS its claim — no silent relaunch loop; recovery is an operator re-dispatch");
  assert.equal(poll(st, MACH_A).length, 0, "and it is not re-offered");
});

test("total launch failure: wave dispatched with an all-failed launch_error", () => {
  const st = makeStore();
  const w = addWave(st);
  const [a, b] = [addSession(st, w), addSession(st, w)];
  for (const s of [a, b]) claim(st, MACH_A, s.id);
  ack(st, MACH_A, a.id, false, "worktree missing");
  ack(st, MACH_A, b.id, false);
  assert.equal(w.status, "dispatched");
  assert.equal(w.launch_error, "2/2 sessions failed to launch");
  assert.equal(b.launch_error, "launch_failed", "a bare failure ack still records something");
});

test("an unclaimed session keeps the wave in launching (never a premature dispatch)", () => {
  const st = makeStore();
  const w = addWave(st);
  const a = addSession(st, w);
  addSession(st, w);                              // never claimed (e.g. the agent is offline)
  claim(st, MACH_A, a.id);
  ack(st, MACH_A, a.id, true);
  assert.equal(w.status, "launching",
    "unclaimed work counts as pending — the sweeper surfaces a stuck wave, ack does not paper over it");
});

// ── Late / duplicate acks ────────────────────────────────────────────────────
test("late duplicate ack is idempotent: no restamp, no wave regression", () => {
  const st = makeStore();
  const w = addWave(st);
  const s = addSession(st, w);
  claim(st, MACH_A, s.id);
  ack(st, MACH_A, s.id, true);
  assert.equal(w.status, "dispatched");
  const firstLaunchedAt = s.launched_at;

  ack(st, MACH_A, s.id, true);                    // a retried/duplicate ack lands later
  assert.equal(s.launched_at, firstLaunchedAt, "launched_at is preserve-on-null");
  assert.equal(w.status, "dispatched", "the wave does not regress to launching");
  assert.equal(w.launch_error, null);
});

test("late ack after the operator moved the wave on does not drag it back", () => {
  const st = makeStore();
  const w = addWave(st);
  const s = addSession(st, w);
  claim(st, MACH_A, s.id);
  ack(st, MACH_A, s.id, true);
  w.status = "reviewing";                         // operator moved it on in the cockpit

  ack(st, MACH_A, s.id, false, "a stale retry reports failure");
  assert.equal(w.status, "reviewing", "waveLaunchOutcome refuses to touch a non-launchable wave");
  assert.equal(s.launch_error, "a stale retry reports failure",
    "...but the session-level audit trail is still written");
});

test("late ack on an abandoned wave still records the session outcome", () => {
  const st = makeStore();
  const w = addWave(st);
  const s = addSession(st, w);
  claim(st, MACH_A, s.id);
  w.status = "abandoned";
  assert.deepEqual(ack(st, MACH_A, s.id, true), { ok: true });
  assert.ok(s.launched_at, "an already-launched process must be recorded even if the wave was abandoned");
  assert.equal(w.status, "abandoned");
});

test("ack succeeds after ingest has already flipped the session to running", () => {
  const st = makeStore();
  const w = addWave(st);
  const s = addSession(st, w);
  claim(st, MACH_A, s.id);
  s.status = "running";                           // the launched process reported in first
  assert.deepEqual(ack(st, MACH_A, s.id, true), { ok: true });
  assert.ok(s.launched_at);
  assert.equal(w.status, "dispatched");
});

// ── Unit-level guards on the pure helpers ────────────────────────────────────
test("ackSessionPatch: success clears a prior error, failure truncates and defaults", () => {
  const ok = ackSessionPatch({ session: { launched_at: null, launch_error: "old" }, ok: true, nowIso: "T" });
  assert.equal(ok.launched_at, "T");
  assert.equal(ok.launch_error, null, "a retry that succeeds clears the stale error");

  const long = ackSessionPatch({ session: {}, ok: false, error: "x".repeat(5000), nowIso: "T" });
  assert.equal(long.launch_error.length, 2000, "error text is bounded");
  assert.equal(ackSessionPatch({ session: {}, ok: false, error: "   ", nowIso: "T" }).launch_error, "launch_failed");
  assert.equal(ackSessionPatch({ session: {}, ok: false, error: 42, nowIso: "T" }).launch_error, "launch_failed");
  assert.equal("launched_at" in ackSessionPatch({ session: {}, ok: false, nowIso: "T" }), false,
    "a failure ack must not stamp launched_at");
});

test("claimPrecheck refusal reasons", () => {
  const base = { machine_id: MACH_A, status: "planned", claimed_at: null, wave_status: "confirmed" };
  assert.ok(claimPrecheck({ session: base, machineId: MACH_A }).ok);
  assert.equal(claimPrecheck({ session: null, machineId: MACH_A }).reason, "unknown_session");
  assert.equal(claimPrecheck({ session: base, machineId: MACH_B }).reason, "unknown_session");
  assert.equal(claimPrecheck({ session: base, machineId: null }).reason, "unknown_session");
  assert.equal(claimPrecheck({ session: { ...base, wave_status: "done" }, machineId: MACH_A }).reason, "wave_not_launchable");
  assert.equal(claimPrecheck({ session: { ...base, wave_status: null }, machineId: MACH_A }).reason, "wave_not_launchable",
    "an ungrouped session (wave_id null) is never launchable");
  assert.equal(claimPrecheck({ session: { ...base, status: "done" }, machineId: MACH_A }).reason, "session_not_launchable");
  assert.equal(claimPrecheck({ session: { ...base, claimed_at: "t1" }, machineId: MACH_A }).reason, "already_claimed");
});

test("waveLaunchOutcome returns null (no change) for every non-completion case", () => {
  const done = [{ launched_at: "t", launch_error: null }];
  assert.equal(waveLaunchOutcome({ waveStatus: "abandoned", sessions: done }), null);
  assert.equal(waveLaunchOutcome({ waveStatus: "dispatched", sessions: done }), null);
  assert.equal(waveLaunchOutcome({ waveStatus: "launching", sessions: [] }), null, "empty wave stays put");
  assert.equal(
    waveLaunchOutcome({ waveStatus: "launching", sessions: [...done, { launched_at: null, launch_error: null }] }),
    null, "one pending session blocks completion");
  assert.deepEqual(waveLaunchOutcome({ waveStatus: "confirmed", sessions: done }),
    { status: "dispatched", launch_error: null },
    "a single-session wave can complete straight from confirmed");
});
