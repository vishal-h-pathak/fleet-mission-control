#!/usr/bin/env node
// Compose validation self-test (offline, zero deps, no DB).
//   node lib/compose/validate.test.mjs   (exit 0 = all passed)

import assert from "node:assert/strict";
import {
  isArmed,
  isValidBranch,
  isValidModel,
  isValidPromptRef,
  isValidSessionName,
  isValidWaveName,
  promptSlug,
} from "./validate.mjs";

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

console.log("Compose validation self-test\n");

ok("isValidSessionName accepts the charset", () => {
  assert.equal(isValidSessionName("feat/mcv2-compose"), true);
  assert.equal(isValidSessionName("a.b_c-1/2"), true);
});

ok("isValidSessionName rejects spaces/shell metacharacters/empty", () => {
  assert.equal(isValidSessionName("feat/mcv2 compose"), false);
  assert.equal(isValidSessionName("feat/x; rm -rf /"), false);
  assert.equal(isValidSessionName(""), false);
  assert.equal(isValidSessionName("a".repeat(201)), false);
  assert.equal(isValidSessionName(undefined), false);
});

ok("isValidBranch mirrors isValidSessionName's charset", () => {
  assert.equal(isValidBranch("feat/mcv2-compose"), true);
  assert.equal(isValidBranch("$(whoami)"), false);
});

ok("isValidPromptRef accepts a committed-prompt path", () => {
  assert.equal(isValidPromptRef("ops/prompts/PROMPT_mcv2_compose.md"), true);
});

ok("isValidPromptRef rejects traversal, wrong dir, wrong prefix/suffix", () => {
  assert.equal(isValidPromptRef("ops/prompts/../../etc/passwd"), false);
  assert.equal(isValidPromptRef("ops/prompts/PROMPT_x.md/../../x"), false);
  assert.equal(isValidPromptRef("PROMPT_x.md"), false);
  assert.equal(isValidPromptRef("ops/prompts/NOTES_x.md"), false);
  assert.equal(isValidPromptRef("ops/prompts/PROMPT_x.txt"), false);
});

ok("isValidModel accepts exactly the three tiers", () => {
  assert.equal(isValidModel("haiku"), true);
  assert.equal(isValidModel("sonnet"), true);
  assert.equal(isValidModel("opus"), true);
  assert.equal(isValidModel("gpt-4"), false);
  assert.equal(isValidModel(""), false);
});

ok("isValidWaveName trims-checks non-blank and caps length", () => {
  assert.equal(isValidWaveName("mcv2-w3-selftest"), true);
  assert.equal(isValidWaveName("   "), false);
  assert.equal(isValidWaveName(""), false);
  assert.equal(isValidWaveName("a".repeat(201)), false);
  assert.equal(isValidWaveName("a".repeat(200)), true);
});

ok("promptSlug converts underscores to hyphens", () => {
  assert.equal(promptSlug("PROMPT_mcv2_compose.md"), "mcv2-compose");
  assert.equal(promptSlug("PROMPT_fleet_conventions.md"), "fleet-conventions");
});

ok("promptSlug rejects non-prompt filenames", () => {
  assert.equal(promptSlug("README.md"), null);
  assert.equal(promptSlug("PROMPT_x.txt"), null);
});

ok("isArmed requires an exact, untrimmed match", () => {
  assert.equal(isArmed("mcv2-w3-selftest", "mcv2-w3-selftest"), true);
  assert.equal(isArmed("mcv2-w3-selftest ", "mcv2-w3-selftest"), false);
  assert.equal(isArmed("MCV2-W3-SELFTEST", "mcv2-w3-selftest"), false);
  assert.equal(isArmed("", "mcv2-w3-selftest"), false);
  assert.equal(isArmed(undefined, "mcv2-w3-selftest"), false);
});

console.log(`\n${passed} passed`);
if (process.exitCode) {
  console.error("\nSELF-TEST FAILED");
} else {
  console.log("\nAll good.");
}
