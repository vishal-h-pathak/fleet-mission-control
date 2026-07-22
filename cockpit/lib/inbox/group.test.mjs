#!/usr/bin/env node
// Inbox grouping self-test (offline, zero deps, fixture data — no DB).
//   node lib/inbox/group.test.mjs   (exit 0 = all passed)
//
// Covers groupInboxSessions(): the pure function that buckets fleet_sessions
// rows (already joined to wave/machine name + latest decision) into the three
// Inbox groups and sorts each. Written before group.mjs existed, per TDD.

import assert from "node:assert/strict";
import { groupInboxSessions } from "./group.mjs";

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
    repo: "owner/portfolio",
    branch: "feat/default",
    worktree: "../pf-wt/default",
    model: "sonnet",
    prompt_ref: null,
    directive: null,
    last_message: null,
    rc_url: null,
    pr_url: null,
    dispatched_at: "2026-07-22T10:00:00.000Z",
    started_at: "2026-07-22T10:00:05.000Z",
    ended_at: null,
    created_at: "2026-07-22T10:00:00.000Z",
    updated_at: "2026-07-22T10:00:00.000Z",
    wave_name: "mcv2-wave1",
    machine_name: "sentry",
    latest_decision: null,
    ...overrides,
  };
}

console.log("Inbox grouping self-test\n");

ok("empty input -> all three groups empty", () => {
  const result = groupInboxSessions([]);
  assert.deepEqual(result, {
    needsYou: [],
    awaitingReview: [],
    recentlyDecided: [],
  });
});

ok("status routes to the correct bucket", () => {
  const waiting = session({ id: "a", status: "waiting" });
  const done = session({ id: "b", status: "done" });
  const reviewed = session({
    id: "c",
    status: "reviewed",
    latest_decision: {
      action: "approve_merge",
      feedback: null,
      created_at: "2026-07-22T11:00:00.000Z",
    },
  });
  const merged = session({
    id: "d",
    status: "merged",
    latest_decision: {
      action: "approve_merge",
      feedback: null,
      created_at: "2026-07-22T11:05:00.000Z",
    },
  });
  const rejected = session({
    id: "e",
    status: "rejected",
    latest_decision: {
      action: "reject",
      feedback: null,
      created_at: "2026-07-22T11:10:00.000Z",
    },
  });

  const result = groupInboxSessions([
    waiting,
    done,
    reviewed,
    merged,
    rejected,
  ]);
  assert.deepEqual(
    result.needsYou.map((s) => s.id),
    ["a"],
  );
  assert.deepEqual(
    result.awaitingReview.map((s) => s.id),
    ["b"],
  );
  assert.deepEqual(
    result.recentlyDecided.map((s) => s.id).sort(),
    ["c", "d", "e"],
  );
});

ok("planned/running sessions are excluded from every group (Waves-board territory, not Inbox v1)", () => {
  const planned = session({ id: "p", status: "planned" });
  const running = session({ id: "r", status: "running" });
  const result = groupInboxSessions([planned, running]);
  assert.deepEqual(result, {
    needsYou: [],
    awaitingReview: [],
    recentlyDecided: [],
  });
});

ok("needsYou and awaitingReview sort by updated_at, most recent first", () => {
  const older = session({
    id: "older",
    status: "waiting",
    updated_at: "2026-07-22T09:00:00.000Z",
  });
  const newer = session({
    id: "newer",
    status: "waiting",
    updated_at: "2026-07-22T12:00:00.000Z",
  });
  const result = groupInboxSessions([older, newer]);
  assert.deepEqual(
    result.needsYou.map((s) => s.id),
    ["newer", "older"],
  );
});

ok("recentlyDecided sorts by latest_decision.created_at, not updated_at", () => {
  // Deliberately give the session with the OLDER decision a NEWER updated_at,
  // to prove the sort key is the decision timestamp, not session updated_at.
  const decidedFirst = session({
    id: "decided-first",
    status: "reviewed",
    updated_at: "2026-07-22T15:00:00.000Z",
    latest_decision: {
      action: "approve_merge",
      feedback: null,
      created_at: "2026-07-22T10:00:00.000Z",
    },
  });
  const decidedSecond = session({
    id: "decided-second",
    status: "rejected",
    updated_at: "2026-07-22T10:30:00.000Z",
    latest_decision: {
      action: "reject",
      feedback: "flaky test",
      created_at: "2026-07-22T14:00:00.000Z",
    },
  });
  const result = groupInboxSessions([decidedFirst, decidedSecond]);
  assert.deepEqual(
    result.recentlyDecided.map((s) => s.id),
    ["decided-second", "decided-first"],
  );
});

ok("recentlyDecided falls back to updated_at when latest_decision is missing", () => {
  const noDecision = session({
    id: "no-decision",
    status: "merged",
    updated_at: "2026-07-22T13:00:00.000Z",
    latest_decision: null,
  });
  const withDecision = session({
    id: "with-decision",
    status: "reviewed",
    updated_at: "2026-07-22T09:00:00.000Z",
    latest_decision: {
      action: "approve_merge",
      feedback: null,
      created_at: "2026-07-22T09:05:00.000Z",
    },
  });
  const result = groupInboxSessions([noDecision, withDecision]);
  assert.deepEqual(
    result.recentlyDecided.map((s) => s.id),
    ["no-decision", "with-decision"],
  );
});

ok("recentlyDecided is capped at recentlyDecidedLimit (default 20)", () => {
  const many = Array.from({ length: 25 }, (_, i) =>
    session({
      id: `s${i}`,
      status: "reviewed",
      latest_decision: {
        action: "approve_merge",
        feedback: null,
        created_at: new Date(2026, 6, 22, 0, i).toISOString(),
      },
    }),
  );
  const result = groupInboxSessions(many);
  assert.equal(result.recentlyDecided.length, 20);
  // Most recent (highest i) first.
  assert.equal(result.recentlyDecided[0].id, "s24");
});

ok("recentlyDecidedLimit is configurable", () => {
  const many = Array.from({ length: 5 }, (_, i) =>
    session({
      id: `s${i}`,
      status: "merged",
      latest_decision: {
        action: "approve_merge",
        feedback: null,
        created_at: new Date(2026, 6, 22, 0, i).toISOString(),
      },
    }),
  );
  const result = groupInboxSessions(many, { recentlyDecidedLimit: 2 });
  assert.equal(result.recentlyDecided.length, 2);
  assert.deepEqual(
    result.recentlyDecided.map((s) => s.id),
    ["s4", "s3"],
  );
});

ok("does not mutate the input array", () => {
  const input = [
    session({ id: "x", status: "waiting", updated_at: "2026-07-22T09:00:00.000Z" }),
    session({ id: "y", status: "waiting", updated_at: "2026-07-22T12:00:00.000Z" }),
  ];
  const frozenOrder = input.map((s) => s.id);
  groupInboxSessions(input);
  assert.deepEqual(
    input.map((s) => s.id),
    frozenOrder,
  );
});

console.log(`\n${passed} passed`);
if (process.exitCode) {
  console.error("\nSELF-TEST FAILED");
} else {
  console.log("\nAll good.");
}
