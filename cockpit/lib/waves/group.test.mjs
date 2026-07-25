#!/usr/bin/env node
// Waves-board grouping self-test (offline, zero deps, fixture data — no DB).
//   node lib/waves/group.test.mjs   (exit 0 = all passed)
//
// Covers groupSessionsByProjectAndWave(): the pure function that buckets
// fleet_sessions rows (already joined to wave name/status/dispatched_at/
// notes + machine name) project -> wave, "ungrouped" as a pseudo-wave per
// project. Written before group.mjs existed, per TDD.

import assert from "node:assert/strict";
import { groupSessionsByProjectAndWave } from "./group.mjs";

let passed = 0;
function ok(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    console.error(`FAIL  ${name}\n      ${e.stack ?? e.message}`);
    process.exitCode = 1;
  }
}

function session(overrides) {
  return {
    id: "id-default",
    name: "feat/default",
    status: "done",
    project: "portfolio",
    wave_id: "wave-1",
    wave_name: "mcv2-wave1",
    wave_status: "dispatched",
    wave_dispatched_at: "2026-07-22T10:00:00.000Z",
    wave_notes: null,
    created_at: "2026-07-22T10:00:00.000Z",
    updated_at: "2026-07-22T10:00:00.000Z",
    ...overrides,
  };
}

console.log("Waves grouping self-test\n");

ok("empty input -> empty result", () => {
  assert.deepEqual(groupSessionsByProjectAndWave([]), []);
});

ok("groups by project then wave", () => {
  const a = session({ id: "a", project: "portfolio", wave_id: "w1", wave_name: "wave-one" });
  const b = session({ id: "b", project: "portfolio", wave_id: "w1", wave_name: "wave-one" });
  const c = session({ id: "c", project: "jobify", wave_id: "w2", wave_name: "wave-two" });
  const result = groupSessionsByProjectAndWave([a, b, c]);
  assert.equal(result.length, 2);
  const portfolio = result.find((p) => p.project === "portfolio");
  const jobify = result.find((p) => p.project === "jobify");
  assert.equal(portfolio.waves.length, 1);
  assert.deepEqual(portfolio.waves[0].sessions.map((s) => s.id).sort(), ["a", "b"]);
  assert.equal(jobify.waves.length, 1);
  assert.equal(jobify.waves[0].name, "wave-two");
});

ok("null wave_id becomes the 'ungrouped' pseudo-wave, sorted last", () => {
  const grouped = session({ id: "g", wave_id: "w1", wave_name: "real-wave", wave_dispatched_at: "2026-07-20T00:00:00.000Z" });
  const ungrouped = session({ id: "u", wave_id: null, wave_name: null, wave_status: null, wave_dispatched_at: null, updated_at: "2026-07-25T00:00:00.000Z" });
  const result = groupSessionsByProjectAndWave([ungrouped, grouped]);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].waves.map((w) => w.name), ["real-wave", "ungrouped"]);
  assert.equal(result[0].waves[1].id, null);
  assert.equal(result[0].waves[1].status, null);
});

ok("real waves sort newest-first by dispatched_at", () => {
  const older = session({ id: "o", wave_id: "w-old", wave_name: "old-wave", wave_dispatched_at: "2026-07-01T00:00:00.000Z" });
  const newer = session({ id: "n", wave_id: "w-new", wave_name: "new-wave", wave_dispatched_at: "2026-07-20T00:00:00.000Z" });
  const result = groupSessionsByProjectAndWave([older, newer]);
  assert.deepEqual(result[0].waves.map((w) => w.name), ["new-wave", "old-wave"]);
});

ok("wave missing dispatched_at falls back to its most-recent session's updated_at", () => {
  const noDispatch = session({
    id: "nd", wave_id: "w-draft", wave_name: "draft-wave", wave_dispatched_at: null,
    updated_at: "2026-07-24T00:00:00.000Z",
  });
  const dispatched = session({ id: "d", wave_id: "w-real", wave_name: "real-wave", wave_dispatched_at: "2026-07-01T00:00:00.000Z" });
  const result = groupSessionsByProjectAndWave([dispatched, noDispatch]);
  // draft-wave's fallback (2026-07-24) is newer than real-wave's explicit dispatched_at (2026-07-01).
  assert.deepEqual(result[0].waves.map((w) => w.name), ["draft-wave", "real-wave"]);
});

ok("sessions within a wave sort by updated_at descending", () => {
  const older = session({ id: "o", updated_at: "2026-07-22T09:00:00.000Z" });
  const newer = session({ id: "n", updated_at: "2026-07-22T12:00:00.000Z" });
  const result = groupSessionsByProjectAndWave([older, newer]);
  assert.deepEqual(result[0].waves[0].sessions.map((s) => s.id), ["n", "o"]);
});

ok("projects sort by most-recent session activity descending", () => {
  const stale = session({ id: "s", project: "old-project", wave_id: "w1", updated_at: "2026-07-01T00:00:00.000Z" });
  const fresh = session({ id: "f", project: "fresh-project", wave_id: "w2", updated_at: "2026-07-25T00:00:00.000Z" });
  const result = groupSessionsByProjectAndWave([stale, fresh]);
  assert.deepEqual(result.map((p) => p.project), ["fresh-project", "old-project"]);
});

ok("null/blank project falls into a single null-keyed bucket", () => {
  const noProject = session({ id: "np", project: null, wave_id: "w1" });
  const blankProject = session({ id: "bp", project: "  ", wave_id: "w1" });
  const result = groupSessionsByProjectAndWave([noProject, blankProject]);
  assert.equal(result.length, 1);
  assert.equal(result[0].project, null);
  assert.deepEqual(result[0].waves[0].sessions.map((s) => s.id).sort(), ["bp", "np"]);
});

ok("statusCounts tallies all seven statuses, zero-filled", () => {
  const planned = session({ id: "p", status: "planned", wave_id: "w1" });
  const running = session({ id: "r", status: "running", wave_id: "w1" });
  const result = groupSessionsByProjectAndWave([planned, running]);
  assert.deepEqual(result[0].waves[0].statusCounts, {
    planned: 1, running: 1, waiting: 0, done: 0, reviewed: 0, merged: 0, rejected: 0,
  });
});

ok("does not mutate the input array", () => {
  const input = [session({ id: "x" }), session({ id: "y", wave_id: "w2" })];
  const frozenOrder = input.map((s) => s.id);
  groupSessionsByProjectAndWave(input);
  assert.deepEqual(input.map((s) => s.id), frozenOrder);
});

console.log(`\n${passed} passed`);
if (process.exitCode) {
  console.error("\nSELF-TEST FAILED");
} else {
  console.log("\nAll good.");
}
