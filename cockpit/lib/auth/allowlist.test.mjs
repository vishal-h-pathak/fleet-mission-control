#!/usr/bin/env node
// Cockpit allowlist self-test (offline, zero deps). Covers the
// COCKPIT_ALLOWED_EMAILS comma-separated / trimmed / case-insensitive compare
// used by proxy.ts to gate authed-but-unauthorized sessions.
//   node lib/auth/allowlist.test.mjs   (exit 0 = all passed)

import assert from "node:assert/strict";
import { isAllowedEmail } from "./allowlist.mjs";

let passed = 0;
function ok(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    console.error(`FAIL  ${name}\n      ${e.message}`);
    process.exitCode = 1;
  }
}

console.log("Cockpit allowlist self-test\n");

ok("exact match, single-entry list", () => {
  assert.equal(isAllowedEmail("vshlpthk1@gmail.com", "vshlpthk1@gmail.com"), true);
});

ok("case-insensitive on both sides", () => {
  assert.equal(isAllowedEmail("Vshlpthk1@Gmail.com", "vshlpthk1@gmail.com"), true);
  assert.equal(isAllowedEmail("vshlpthk1@gmail.com", "VSHLPTHK1@GMAIL.COM"), true);
});

ok("multi-entry list, whitespace around commas trimmed", () => {
  const list = " alice@example.com, vshlpthk1@gmail.com ,bob@example.com";
  assert.equal(isAllowedEmail("vshlpthk1@gmail.com", list), true);
  assert.equal(isAllowedEmail("alice@example.com", list), true);
  assert.equal(isAllowedEmail("bob@example.com", list), true);
});

ok("email not in list rejected", () => {
  assert.equal(isAllowedEmail("mallory@example.com", "alice@example.com,bob@example.com"), false);
});

ok("substring / suffix confusion is NOT a match (no partial match)", () => {
  // "bob@example.com.evil.com" must not be treated as allowed just because it
  // contains "bob@example.com" as a substring.
  assert.equal(isAllowedEmail("bob@example.com.evil.com", "bob@example.com"), false);
  // and the reverse: a shorter attacker-controlled email must not match a
  // longer allowed entry either.
  assert.equal(isAllowedEmail("bob@example.com", "evilbob@example.com"), false);
});

ok("empty / missing email is rejected", () => {
  assert.equal(isAllowedEmail("", "alice@example.com"), false);
  assert.equal(isAllowedEmail(null, "alice@example.com"), false);
  assert.equal(isAllowedEmail(undefined, "alice@example.com"), false);
});

ok("empty / missing allowlist rejects everyone (fail closed)", () => {
  assert.equal(isAllowedEmail("alice@example.com", ""), false);
  assert.equal(isAllowedEmail("alice@example.com", null), false);
  assert.equal(isAllowedEmail("alice@example.com", undefined), false);
});

ok("blank entries between commas are ignored, not treated as a wildcard", () => {
  assert.equal(isAllowedEmail("anyone@example.com", "alice@example.com,,bob@example.com"), false);
  assert.equal(isAllowedEmail("", "alice@example.com,,bob@example.com"), false);
});

ok("leading/trailing whitespace on the candidate email is trimmed", () => {
  assert.equal(isAllowedEmail("  vshlpthk1@gmail.com  ", "vshlpthk1@gmail.com"), true);
});

console.log(`\n${passed} passed`);
if (process.exitCode) {
  console.error("\nSELF-TEST FAILED");
} else {
  console.log("\nAll good.");
}
