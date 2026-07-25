#!/usr/bin/env node
// Decision status-transition self-test (offline, zero deps, no DB).
//   node lib/inbox/decisions-core.test.mjs   (exit 0 = all passed)
//
// Covers the pure mapping/validation the decision API routes rely on:
// action -> next fleet_sessions.status, and payload validation (feedback
// required for redispatch_with_feedback, forbidden action rejected). Written
// before decisions-core.mjs existed, per TDD.

import assert from "node:assert/strict";
import {
  nextStatusForDecision,
  validateDecisionPayload,
} from "./decisions-core.mjs";

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

console.log("Decision status-transition self-test\n");

ok("approve_merge -> reviewed", () => {
  assert.equal(nextStatusForDecision("approve_merge"), "reviewed");
});

ok("redispatch_with_feedback -> reviewed", () => {
  assert.equal(nextStatusForDecision("redispatch_with_feedback"), "reviewed");
});

ok("reject -> rejected", () => {
  assert.equal(nextStatusForDecision("reject"), "rejected");
});

ok("dismissed -> reviewed", () => {
  assert.equal(nextStatusForDecision("dismissed"), "reviewed");
});

ok("unknown action throws", () => {
  assert.throws(() => nextStatusForDecision("approve"), /unknown decision action/);
  assert.throws(() => nextStatusForDecision(""), /unknown decision action/);
  assert.throws(() => nextStatusForDecision(undefined), /unknown decision action/);
});

ok("validateDecisionPayload: approve_merge needs no feedback", () => {
  const result = validateDecisionPayload("approve_merge", {});
  assert.deepEqual(result, { ok: true, feedback: null });
});

ok("validateDecisionPayload: approve_merge ignores an incidental feedback field", () => {
  const result = validateDecisionPayload("approve_merge", { feedback: "whatever" });
  assert.deepEqual(result, { ok: true, feedback: null });
});

ok("validateDecisionPayload: reject needs no feedback", () => {
  const result = validateDecisionPayload("reject", {});
  assert.deepEqual(result, { ok: true, feedback: null });
});

ok("validateDecisionPayload: dismissed needs no feedback", () => {
  const result = validateDecisionPayload("dismissed", {});
  assert.deepEqual(result, { ok: true, feedback: null });
});

ok("validateDecisionPayload: dismissed ignores an incidental feedback field", () => {
  const result = validateDecisionPayload("dismissed", { feedback: "noise" });
  assert.deepEqual(result, { ok: true, feedback: null });
});

ok("validateDecisionPayload: redispatch_with_feedback requires non-empty feedback", () => {
  assert.deepEqual(validateDecisionPayload("redispatch_with_feedback", {}), {
    ok: false,
    error: "feedback_required",
  });
  assert.deepEqual(
    validateDecisionPayload("redispatch_with_feedback", { feedback: "" }),
    { ok: false, error: "feedback_required" },
  );
  assert.deepEqual(
    validateDecisionPayload("redispatch_with_feedback", { feedback: "   " }),
    { ok: false, error: "feedback_required" },
  );
});

ok("validateDecisionPayload: redispatch_with_feedback trims and accepts real feedback", () => {
  const result = validateDecisionPayload("redispatch_with_feedback", {
    feedback: "  please add a test for the empty case  ",
  });
  assert.deepEqual(result, {
    ok: true,
    feedback: "please add a test for the empty case",
  });
});

ok("validateDecisionPayload: rejects an unknown action", () => {
  assert.deepEqual(validateDecisionPayload("approve", {}), {
    ok: false,
    error: "invalid_action",
  });
});

console.log(`\n${passed} passed`);
if (process.exitCode) {
  console.error("\nSELF-TEST FAILED");
} else {
  console.log("\nAll good.");
}
