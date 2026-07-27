// Allowlist parity guard. The control agent (agent/allowlist.mjs) and the dashboard
// dispatch route (web/lib/commands/allowlist.mjs) MUST agree on what they accept/reject —
// otherwise the dashboard can queue commands the agent then rejects (or vice versa).
// The two files have different return shapes by design (agent → argv; web → normalized
// args), so we compare the ACCEPT/REJECT verdict (`ok`) over a table of vectors, including
// the security-relevant edge cases. Exit non-zero on any disagreement.
//
//   node scripts/check-allowlist-parity.mjs
//
// MCv2 M4 extends this guard past the verbs to the WAVE-LAUNCH gauntlet (sections
// 4–6 below): the fixed repo set, the model set, and the validators that decide
// whether a bus row may spawn `claude` on this box. Those have no web-side twin
// yet (the cockpit's Compose screen is a sibling wave), so the guard has three
// jobs there: restate the expected sets INDEPENDENTLY so a silent widening fails
// loudly, pin the accept/reject verdicts of the validators, and cross-check the
// agent against the `dispatch` Edge Function's own field allowlist so the two
// halves of the contract cannot drift apart.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  validateCommand as agentValidate,
  verbRequiresApproval as agentRequiresApproval,
  ALLOWED_VERBS as AGENT_VERBS,
  validateLaunchSession,
  composeDirective,
  LAUNCH_REPOS,
  LAUNCH_REPO_SLUGS,
  LAUNCH_MODELS,
  LAUNCH_WAVE_STATUSES,
  LAUNCH_CONSUMED_FIELDS,
  PROMPT_REF_RE,
} from "../agent/allowlist.mjs";
import {
  POLL_SESSION_FIELDS,
  POLL_FORBIDDEN_FIELDS,
  WAVE_LAUNCHABLE,
} from "../supabase/functions/dispatch/dispatch-logic.mjs";
import {
  validateCommand as webValidate,
  // The web allowlist (dashboard side) names this export `requiresApproval`; the agent
  // side names it `verbRequiresApproval`. Same semantics — alias both to a common name.
  requiresApproval as webRequiresApproval,
  ALLOWED_VERBS as WEB_VERBS,
} from "../web/lib/commands/allowlist.mjs";

const N100 = "a".repeat(100);
const vectors = [
  ["check", {}],
  ["check", { x: 1 }],
  ["status", {}],
  ["pull", {}],
  ["fetch-log", { name: "nav" }],
  ["fetch-log", {}],
  ["fetch-log", { name: N100 }],            // 100 chars: both cap at 64 → both reject
  ["fetch-log", { name: "bad;rm" }],
  ["fetch-log", { name: "a b" }],
  ["fetch-log", { name: "nav", extra: 1 }],
  ["artifact", { relpath: "checkpoints/gen_05.npz" }],
  ["artifact", { relpath: "../etc/passwd" }],
  ["artifact", { relpath: "/etc/passwd" }],
  ["artifact", { relpath: "~/secrets" }],
  ["artifact", { relpath: "a..b/c" }],      // ".." inside a segment
  ["artifact", { relpath: "a//b" }],        // empty segment
  ["artifact", { relpath: "ok/path", dest: "../x" }],
  ["artifact", {}],
  // ── Phase C action verbs ──
  ["morning", {}],
  ["morning", { x: 1 }],
  ["nav", {}],
  ["nav", { repo: "portfolio" }],
  ["run", { repo: "cellular-gaits", directive: "tidy the README" }],
  ["run", { repo: "portfolio", directive: `weird: $(id) "q" 'a' | & ;` }], // metachars ok (base64'd)
  ["run", { repo: "evil", directive: "go" }],                  // repo outside fixed set
  ["run", { repo: "portfolio" }],                              // missing directive
  ["run", { repo: "portfolio", directive: "" }],               // empty directive
  ["run", { repo: "portfolio", directive: "a".repeat(2000) }], // at cap → accept
  ["run", { repo: "portfolio", directive: "a".repeat(2001) }], // over cap → reject
  ["run", { repo: "portfolio", directive: "has\nnewline" }],   // control char → reject
  ["run", { repo: "portfolio", directive: "go", evil: 1 }],    // extra key → reject
  ["exec", { cmd: "rm -rf ~" }],            // not a verb
  ["", {}],
];

let mismatches = 0;

// 1) Accept/reject verdict parity over the vector table.
for (const [verb, args] of vectors) {
  const a = agentValidate(verb, args).ok === true;
  const w = webValidate(verb, args).ok === true;
  const tag = a === w ? "ok  " : "DIFF";
  if (a !== w) mismatches++;
  console.log(`${tag}  agent=${a ? "accept" : "reject"}  web=${w ? "accept" : "reject"}  ${verb} ${JSON.stringify(args)}`);
}

// 2) The two files must expose the SAME verb set.
const agentSet = [...AGENT_VERBS].sort().join(",");
const webSet = [...WEB_VERBS].sort().join(",");
if (agentSet !== webSet) {
  mismatches++;
  console.log(`DIFF  verb sets differ — agent=[${agentSet}] web=[${webSet}]`);
} else {
  console.log(`ok    verb sets match — [${agentSet}]`);
}

// 3) requiresApproval must agree per verb (else the dashboard gates differently than the agent).
for (const verb of [...new Set([...AGENT_VERBS, ...WEB_VERBS])].sort()) {
  const a = agentRequiresApproval(verb);
  const w = webRequiresApproval(verb);
  const tag = a === w ? "ok  " : "DIFF";
  if (a !== w) mismatches++;
  console.log(`${tag}  requiresApproval  agent=${a}  web=${w}  ${verb}`);
}

// ═══ MCv2 M4 — wave-launch gauntlet ═════════════════════════════════════════
console.log("\n── wave-launch gauntlet (MCv2 M4) ──");

function check(label, cond, detail = "") {
  if (cond) {
    console.log(`ok    ${label}`);
  } else {
    mismatches++;
    console.log(`DIFF  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

// 4) The closed sets, restated here independently. Widening one of these is a
//    security decision; it must never happen as a silent side effect of an edit.
const EXPECTED_REPOS = [
  "vishal-h-pathak/caddiehack",
  "vishal-h-pathak/cellular-gaits",
  "vishal-h-pathak/fleet-mission-control",
  "vishal-h-pathak/jobify",
  "vishal-h-pathak/portfolio",
];
const actualRepos = [...LAUNCH_REPO_SLUGS].sort();
check(
  `launch repo set is the fixed 5 — [${actualRepos.join(", ")}]`,
  actualRepos.join(",") === EXPECTED_REPOS.join(","),
  `expected [${EXPECTED_REPOS.join(", ")}]`
);
check(
  `launch models are [haiku, opus, sonnet]`,
  [...LAUNCH_MODELS].sort().join(",") === "haiku,opus,sonnet",
  `got [${[...LAUNCH_MODELS].join(", ")}]`
);
check(
  "every repo entry is a frozen {checkout, worktreeRoot} pair of safe path segments",
  Object.isFrozen(LAUNCH_REPOS) &&
    Object.values(LAUNCH_REPOS).every(
      (e) => Object.isFrozen(e) && /^[A-Za-z0-9._-]+$/.test(e.checkout) && /^[A-Za-z0-9._-]+$/.test(e.worktreeRoot)
    )
);
check(
  "prompt_ref regex still pins ops/prompts/PROMPT_*.md",
  PROMPT_REF_RE.source === "^ops\\/prompts\\/PROMPT_[A-Za-z0-9_.-]{1,120}\\.md$",
  PROMPT_REF_RE.source
);

// 5) Agent ↔ dispatch-function contract. The agent may consume ONLY fields the
//    function actually projects, and must never consume a firewalled one — the
//    mechanical form of SCHEMA_V2 invariant (c).
check(
  `agent consumes only projected fields — [${LAUNCH_CONSUMED_FIELDS.join(", ")}]`,
  LAUNCH_CONSUMED_FIELDS.every((f) => POLL_SESSION_FIELDS.includes(f)),
  `POLL_SESSION_FIELDS=[${POLL_SESSION_FIELDS.join(", ")}]`
);
check(
  `agent consumes NO forbidden field — [${POLL_FORBIDDEN_FIELDS.join(", ")}]`,
  LAUNCH_CONSUMED_FIELDS.every((f) => !POLL_FORBIDDEN_FIELDS.includes(f))
);
check(
  "agent's launchable wave statuses match the function's WAVE_LAUNCHABLE",
  [...LAUNCH_WAVE_STATUSES].sort().join(",") === [...WAVE_LAUNCHABLE].sort().join(","),
  `agent=[${[...LAUNCH_WAVE_STATUSES].join(", ")}] function=[${[...WAVE_LAUNCHABLE].join(", ")}]`
);

// 6) Verdict table for the gauntlet itself. Each vector pins an accept/reject the
//    security review signed off on; a loosened validator flips one and fails here.
const OK_UUID = "11111111-2222-4333-8444-555555555555";
const BASE_WAVE = { id: OK_UUID, name: "w", status: "confirmed", project: { repo: "vishal-h-pathak/portfolio" } };
const BASE_SESSION = {
  id: OK_UUID, name: "s1", repo: "vishal-h-pathak/portfolio", branch: "feat/x",
  model: "sonnet", prompt_ref: "ops/prompts/PROMPT_x.md",
};
const launchVectors = [
  ["baseline", {}, {}, true],
  ["repo outside the fixed set", { repo: "attacker/pwn" }, {}, false],
  ["repo mismatching the wave project", { repo: "vishal-h-pathak/jobify" }, {}, false],
  ["prompt_ref traversal", { prompt_ref: "../../etc/passwd" }, {}, false],
  ["prompt_ref absolute", { prompt_ref: "/etc/passwd" }, {}, false],
  ["prompt_ref outside ops/prompts", { prompt_ref: "docs/PROMPT_x.md" }, {}, false],
  ["branch flag injection", { branch: "--upload-pack=/tmp/evil" }, {}, false],
  ["branch traversal", { branch: "feat/../../etc" }, {}, false],
  ["name flag injection", { name: "-rf" }, {}, false],
  ["name path separator", { name: "a/b" }, {}, false],
  ["model outside the closed set", { model: "opus-4" }, {}, false],
  ["non-uuid session id", { id: "nope" }, {}, false],
  ["wave not launchable", {}, { status: "abandoned" }, false],
  ["wave draft is not launchable", {}, { status: "draft" }, false],
];
for (const [label, sOver, wOver, expected] of launchVectors) {
  const r = validateLaunchSession({
    session: { ...BASE_SESSION, ...sOver },
    wave: { ...BASE_WAVE, ...wOver },
    repoRoot: "/repos",
  });
  check(`launch ${expected ? "accept" : "reject"}: ${label}`, r.ok === expected, r.reason || "accepted");
}

// The directive template is a security artifact (it is what a launched session is
// told to do). Pin its exact text here as well as in the unit tests: a cockpit
// preview that drifts from what the agent actually seeds is a real defect.
const EXPECTED_DIRECTIVE =
  "Read ./ops/prompts/PROMPT_fleet_conventions.md then ./ops/prompts/PROMPT_x.md " +
  "and implement it on this branch (feat/x). Validate, then STOP and report. " +
  "Do not begin until the operator confirms.";
const composed = composeDirective({ promptRef: "ops/prompts/PROMPT_x.md", branch: "feat/x" });
check("directive template is unchanged", composed.ok && composed.directive === EXPECTED_DIRECTIVE, composed.directive);

// 7) Optional cockpit-side copy (the Compose screen's preview). Absent today —
//    reported as a loud SKIP so nobody mistakes "no copy" for "copies agree".
const here = path.dirname(fileURLToPath(import.meta.url));
const cockpitCopy = path.join(here, "..", "cockpit", "lib", "waves", "launch-allowlist.mjs");
if (fs.existsSync(cockpitCopy)) {
  const web = await import(cockpitCopy);
  const webRepos = [...(web.LAUNCH_REPO_SLUGS || [])].sort().join(",");
  check("cockpit copy: repo sets match", webRepos === actualRepos.join(","), `cockpit=[${webRepos}]`);
  const webDirective = web.composeDirective?.({ promptRef: "ops/prompts/PROMPT_x.md", branch: "feat/x" });
  check("cockpit copy: directive template matches", webDirective?.directive === EXPECTED_DIRECTIVE);
} else {
  console.log("SKIP  no cockpit-side launch allowlist yet (cockpit/lib/waves/launch-allowlist.mjs) —");
  console.log("      when the Compose screen previews the directive, add it and this guard binds it.");
}

console.log(`\n${mismatches === 0 ? "PARITY OK" : `PARITY FAIL — ${mismatches} divergence(s)`}`);
process.exit(mismatches === 0 ? 0 : 1);
