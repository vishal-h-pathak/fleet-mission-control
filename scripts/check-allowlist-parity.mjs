// Allowlist parity guard. The control agent (agent/allowlist.mjs) and the dashboard
// dispatch route (web/lib/commands/allowlist.mjs) MUST agree on what they accept/reject —
// otherwise the dashboard can queue commands the agent then rejects (or vice versa).
// The two files have different return shapes by design (agent → argv; web → normalized
// args), so we compare the ACCEPT/REJECT verdict (`ok`) over a table of vectors, including
// the security-relevant edge cases. Exit non-zero on any disagreement.
//
//   node scripts/check-allowlist-parity.mjs
import {
  validateCommand as agentValidate,
  verbRequiresApproval as agentRequiresApproval,
  ALLOWED_VERBS as AGENT_VERBS,
} from "../agent/allowlist.mjs";
import {
  validateCommand as webValidate,
  verbRequiresApproval as webRequiresApproval,
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

console.log(`\n${mismatches === 0 ? "PARITY OK" : `PARITY FAIL — ${mismatches} divergence(s)`}`);
process.exit(mismatches === 0 ? 0 : 1);
