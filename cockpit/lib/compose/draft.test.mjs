#!/usr/bin/env node
// Compose draft-request self-test (offline, zero deps, no DB).
//   node lib/compose/draft.test.mjs   (exit 0 = all passed)

import assert from "node:assert/strict";
import {
  buildSessionInsertRow,
  buildWaveInsertRow,
  validateDraftPayload,
} from "./draft.mjs";

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

const PROJECT_ID = "11111111-1111-1111-1111-111111111111";
const MACHINE_ID = "22222222-2222-2222-2222-222222222222";

function validBody(overrides = {}) {
  return {
    project_id: PROJECT_ID,
    wave_name: "mcv2-w3-selftest",
    chunks: [
      {
        session_name: "feat/mcv2-selftest",
        branch: "feat/mcv2-selftest",
        machine_id: MACHINE_ID,
        model: "sonnet",
        prompt_ref: "ops/prompts/PROMPT_mcv2_selftest.md",
      },
    ],
    ...overrides,
  };
}

console.log("Compose draft self-test\n");

ok("accepts a well-formed single-chunk body", () => {
  const result = validateDraftPayload(validBody());
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.waveName, "mcv2-w3-selftest");
    assert.equal(result.notes, null);
    assert.equal(result.chunks.length, 1);
    assert.equal(result.chunks[0].machineId, MACHINE_ID);
  }
});

ok("accepts and passes through string notes", () => {
  const result = validateDraftPayload(validBody({ notes: "self-test wave" }));
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.notes, "self-test wave");
});

ok("rejects a non-object body", () => {
  assert.deepEqual(validateDraftPayload(null), { ok: false, error: "bad_request" });
  assert.deepEqual(validateDraftPayload("x"), { ok: false, error: "bad_request" });
});

ok("rejects a non-uuid project_id", () => {
  assert.deepEqual(validateDraftPayload(validBody({ project_id: "not-a-uuid" })), {
    ok: false,
    error: "bad_project_id",
  });
});

ok("rejects a blank/oversized wave_name", () => {
  assert.deepEqual(validateDraftPayload(validBody({ wave_name: "" })), {
    ok: false,
    error: "bad_wave_name",
  });
  assert.deepEqual(
    validateDraftPayload(validBody({ wave_name: "a".repeat(201) })),
    { ok: false, error: "bad_wave_name" },
  );
});

ok("rejects non-string notes", () => {
  assert.deepEqual(validateDraftPayload(validBody({ notes: 42 })), {
    ok: false,
    error: "bad_notes",
  });
});

ok("rejects empty or oversized chunks array", () => {
  assert.deepEqual(validateDraftPayload(validBody({ chunks: [] })), {
    ok: false,
    error: "no_chunks",
  });
  const tooMany = Array.from({ length: 101 }, (_, i) => ({
    session_name: `feat/x${i}`,
    branch: `feat/x${i}`,
    machine_id: MACHINE_ID,
    model: "sonnet",
    prompt_ref: "ops/prompts/PROMPT_x.md",
  }));
  assert.deepEqual(validateDraftPayload(validBody({ chunks: tooMany })), {
    ok: false,
    error: "too_many_chunks",
  });
});

ok("rejects a chunk with a bad session_name/branch/machine_id/model/prompt_ref", () => {
  const bad = (patch) =>
    validateDraftPayload(
      validBody({ chunks: [{ ...validBody().chunks[0], ...patch }] }),
    );
  assert.deepEqual(bad({ session_name: "feat/x rm -rf" }), {
    ok: false,
    error: "bad_session_name",
  });
  assert.deepEqual(bad({ branch: "$(whoami)" }), {
    ok: false,
    error: "bad_branch",
  });
  assert.deepEqual(bad({ machine_id: "not-a-uuid" }), {
    ok: false,
    error: "bad_machine_id",
  });
  assert.deepEqual(bad({ model: "gpt-4" }), { ok: false, error: "bad_model" });
  assert.deepEqual(bad({ prompt_ref: "../../etc/passwd" }), {
    ok: false,
    error: "bad_prompt_ref",
  });
});

ok("buildWaveInsertRow carries no registered_by/dispatched_at", () => {
  const row = buildWaveInsertRow({
    projectId: PROJECT_ID,
    waveName: "mcv2-w3-selftest",
    notes: null,
  });
  assert.deepEqual(row, {
    project_id: PROJECT_ID,
    name: "mcv2-w3-selftest",
    status: "draft",
    notes: null,
  });
  assert.equal("registered_by" in row, false);
  assert.equal("dispatched_at" in row, false);
});

ok("buildSessionInsertRow carries no worktree/dispatched_at, composes the directive", () => {
  const row = buildSessionInsertRow({
    waveId: "33333333-3333-3333-3333-333333333333",
    chunk: {
      sessionName: "feat/mcv2-selftest",
      branch: "feat/mcv2-selftest",
      machineId: MACHINE_ID,
      model: "sonnet",
      promptRef: "ops/prompts/PROMPT_mcv2_selftest.md",
    },
    project: "fleet-mission-control",
    repo: "vishal-h-pathak/fleet-mission-control",
  });
  assert.equal(row.status, "planned");
  assert.equal(row.machine_id, MACHINE_ID);
  assert.equal(row.project, "fleet-mission-control");
  assert.equal(row.repo, "vishal-h-pathak/fleet-mission-control");
  assert.equal(
    row.directive,
    "Read ./ops/prompts/PROMPT_fleet_conventions.md then " +
      "./ops/prompts/PROMPT_mcv2_selftest.md and implement it on this " +
      "branch (feat/mcv2-selftest). Validate, then STOP and report. Do " +
      "not begin until the operator confirms.",
  );
  assert.equal("worktree" in row, false);
  assert.equal("dispatched_at" in row, false);
});

console.log(`\n${passed} passed`);
if (process.exitCode) {
  console.error("\nSELF-TEST FAILED");
} else {
  console.log("\nAll good.");
}
