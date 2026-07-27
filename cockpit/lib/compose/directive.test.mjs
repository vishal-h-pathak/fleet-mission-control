#!/usr/bin/env node
// Directive-template self-test (offline, zero deps, no DB).
//   node lib/compose/directive.test.mjs   (exit 0 = all passed)

import assert from "node:assert/strict";
import { composeDirective } from "./directive.mjs";
import { composeDirective as composeDirectiveAgent } from "../../../agent/allowlist.mjs";

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

console.log("Compose directive-template self-test\n");

ok("composes the exact template, parameterized only by promptRef/branch", () => {
  const text = composeDirective({
    promptRef: "ops/prompts/PROMPT_mcv2_compose.md",
    branch: "feat/mcv2-compose",
  });
  assert.equal(
    text,
    "Read ./ops/prompts/PROMPT_fleet_conventions.md then " +
      "./ops/prompts/PROMPT_mcv2_compose.md and implement it on this branch " +
      "(feat/mcv2-compose). Validate, then STOP and report. Do not begin " +
      "until the operator confirms.",
  );
});

ok("bus/free text never enters the template beyond the two fields", () => {
  // Even a maliciously-shaped promptRef/branch (were validation to somehow
  // be skipped upstream) only ever lands in exactly the two designated
  // slots — the template string around them is fixed, not reassembled from
  // any other input.
  const text = composeDirective({ promptRef: "X", branch: "Y" });
  assert.equal(text.startsWith("Read ./ops/prompts/PROMPT_fleet_conventions.md then ./X and implement it on this branch (Y)."), true);
});

ok("byte-identical to the agent's composeDirective — the agent's is what executes; this preview is a copy", () => {
  const fields = { promptRef: "ops/prompts/PROMPT_parity_check.md", branch: "feat/parity-check" };
  const preview = composeDirective(fields);
  const executed = composeDirectiveAgent(fields);
  assert.equal(executed.ok, true);
  assert.equal(preview, executed.directive);
});

console.log(`\n${passed} passed`);
if (process.exitCode) {
  console.error("\nSELF-TEST FAILED");
} else {
  console.log("\nAll good.");
}
