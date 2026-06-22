#!/usr/bin/env node
// Web-side allowlist self-test (offline, zero deps). Covers the Phase C verbs
// (morning / nav / run) and the requiresApproval gate. Mirrors the security
// posture of agent/test.mjs for the dashboard copy.
//   node web/lib/commands/allowlist.test.mjs   (exit 0 = all passed)

import assert from "node:assert/strict";
import {
  validateCommand,
  requiresApproval,
  isAllowedVerb,
  ALLOWED_VERBS,
  RUN_REPOS,
} from "./allowlist.mjs";

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

const allow = (verb, args) => {
  const r = validateCommand(verb, args);
  assert.equal(r.ok, true, `expected ALLOW for ${verb} ${JSON.stringify(args)} — got: ${r.error}`);
  return r.args;
};
const reject = (verb, args) => {
  const r = validateCommand(verb, args);
  assert.equal(r.ok, false, `expected REJECT for ${verb} ${JSON.stringify(args)} — but allowed: ${JSON.stringify(r.args)}`);
};

console.log("Fleet dashboard allowlist self-test\n");

// ── Verb set includes the Phase C verbs ───────────────────────────────────────
ok("allowlist is exactly the 8 Phase C verbs", () => {
  assert.deepEqual(
    [...ALLOWED_VERBS].sort(),
    ["artifact", "check", "fetch-log", "morning", "nav", "pull", "run", "status"],
  );
});

// ── requiresApproval gate ─────────────────────────────────────────────────────
ok("safe verbs do not require approval", () => {
  for (const v of ["check", "status", "fetch-log", "pull", "artifact", "morning"]) {
    assert.equal(requiresApproval(v), false, `${v} should NOT require approval`);
  }
});
ok("nav + run require approval", () => {
  assert.equal(requiresApproval("nav"), true);
  assert.equal(requiresApproval("run"), true);
});
ok("requiresApproval is false for unknown verbs", () => {
  assert.equal(requiresApproval("exec"), false);
  assert.equal(requiresApproval(""), false);
  assert.equal(requiresApproval(null), false);
});

// ── morning / nav: zero-arg ───────────────────────────────────────────────────
ok("morning takes no args", () => {
  assert.deepEqual(allow("morning", {}), {});
  assert.deepEqual(allow("morning", undefined), {});
  reject("morning", { x: 1 });
});
ok("nav takes no args", () => {
  assert.deepEqual(allow("nav", {}), {});
  reject("nav", { repo: "portfolio" });
});

// ── run: repo (fixed set) + directive (≤2000, no control chars) ───────────────
ok("run accepts a valid repo + directive", () => {
  assert.deepEqual(allow("run", { repo: "cellular-gaits", directive: "evolve gait for 50 gens" }), {
    repo: "cellular-gaits",
    directive: "evolve gait for 50 gens",
  });
  allow("run", { repo: "portfolio", directive: "rebuild the site" });
});
ok("RUN_REPOS is the fixed set", () => {
  assert.deepEqual([...RUN_REPOS].sort(), ["cellular-gaits", "portfolio"]);
});
ok("run rejects an off-list repo", () => {
  reject("run", { repo: "evil-repo", directive: "ok" });
  reject("run", { repo: "../etc", directive: "ok" });
  reject("run", { repo: "", directive: "ok" });
});
ok("run rejects a missing directive / repo", () => {
  reject("run", { repo: "cellular-gaits" });
  reject("run", { directive: "ok" });
  reject("run", {});
});
ok("run rejects an over-long directive (>2000)", () => {
  allow("run", { repo: "portfolio", directive: "a".repeat(2000) });
  reject("run", { repo: "portfolio", directive: "a".repeat(2001) });
});
ok("run rejects control chars in directive", () => {
  reject("run", { repo: "portfolio", directive: "line1\nline2" }); // newline is a control char
  reject("run", { repo: "portfolio", directive: "tab\there" });
  reject("run", { repo: "portfolio", directive: `nul${String.fromCharCode(0)}byte` });
  reject("run", { repo: "portfolio", directive: `del${String.fromCharCode(127)}char` });
});
ok("run rejects extra arg keys", () => {
  reject("run", { repo: "portfolio", directive: "ok", evil: 1 });
});
ok("run rejects non-string args", () => {
  reject("run", { repo: 1, directive: "ok" });
  reject("run", { repo: "portfolio", directive: 42 });
});

// ── Closed allowlist still holds ──────────────────────────────────────────────
ok("unknown verb still rejected", () => {
  reject("exec", {});
  reject("Run", { repo: "portfolio", directive: "ok" }); // casing is exact
  assert.equal(isAllowedVerb("nope"), false);
});

console.log(`\n${passed} checks passed${process.exitCode ? " — WITH FAILURES" : ""}`);
