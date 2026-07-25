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

ok("planned sessions are excluded from every group (Waves-board territory, not Inbox v1)", () => {
  const planned = session({ id: "p", status: "planned" });
  const result = groupInboxSessions([planned]);
  assert.deepEqual(result, {
    needsYou: [],
    awaitingReview: [],
    recentlyDecided: [],
  });
});

ok("running sessions land in needsYou, quietly, after waiting sessions", () => {
  const running = session({
    id: "r",
    status: "running",
    updated_at: "2026-07-22T13:00:00.000Z", // newer than the waiting session below
  });
  const waiting = session({
    id: "w",
    status: "waiting",
    updated_at: "2026-07-22T09:00:00.000Z",
  });
  const result = groupInboxSessions([running, waiting]);
  // Even though `running` has the more recent updated_at, `waiting` sessions
  // always sort ahead of `running` ones within needsYou — running is only
  // ever quietly appended below, per docs/SCHEMA_V2.md.
  assert.deepEqual(
    result.needsYou.map((s) => s.id),
    ["w", "r"],
  );
  assert.equal(result.awaitingReview.length, 0);
  assert.equal(result.recentlyDecided.length, 0);
});

ok("multiple running sessions within needsYou still sort by updated_at descending", () => {
  const older = session({
    id: "r-older",
    status: "running",
    updated_at: "2026-07-22T08:00:00.000Z",
  });
  const newer = session({
    id: "r-newer",
    status: "running",
    updated_at: "2026-07-22T11:00:00.000Z",
  });
  const waiting = session({
    id: "w",
    status: "waiting",
    updated_at: "2026-07-22T09:00:00.000Z",
  });
  const result = groupInboxSessions([older, waiting, newer]);
  assert.deepEqual(
    result.needsYou.map((s) => s.id),
    ["w", "r-newer", "r-older"],
  );
});

// The grouping function only decides which *group* a session lands in — it
// carries no notion of "decision affordance" (that's a UI-only concept: the
// showActions prop, which app/inbox-view.tsx hard-wires to `false` for the
// entire "Needs you" section for both `waiting` and `running` rows, and to
// `true` only for the "Awaiting review" section's `done` rows). So there is
// no pure-function assertion to add here for "running rows get no decision
// buttons" — it's structurally guaranteed by that per-section showActions
// wiring in inbox-view.tsx, not by anything groupInboxSessions returns. What
// IS this module's job, and what the two tests above cover, is that a
// `running` session's identity/status survives into needsYou unchanged
// (so the UI has what it needs to render it without those affordances) and
// that it sorts after `waiting` rows.

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

ok("recentlyDecided is capped at recentlyDecidedLimit (default 10)", () => {
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
  assert.equal(result.recentlyDecided.length, 10);
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
