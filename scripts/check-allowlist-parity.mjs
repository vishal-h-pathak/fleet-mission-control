// Allowlist parity guard. The control agent (agent/allowlist.mjs) and the dashboard
// dispatch route (web/lib/commands/allowlist.mjs) MUST agree on what they accept/reject —
// otherwise the dashboard can queue commands the agent then rejects (or vice versa).
// The two files have different return shapes by design (agent → argv; web → normalized
// args), so we compare the ACCEPT/REJECT verdict (`ok`) over a table of vectors, including
// the security-relevant edge cases. Exit non-zero on any disagreement.
//
//   node scripts/check-allowlist-parity.mjs
import { validateCommand as agentValidate } from "../agent/allowlist.mjs";
import { validateCommand as webValidate } from "../web/lib/commands/allowlist.mjs";

const N100 = "a".repeat(100);
const vectors = [
  ["check", {}],
  ["check", { x: 1 }],
  ["status", {}],
  ["pull", {}],
  ["fetch-log", { name: "nav" }],
  ["fetch-log", {}],
  ["fetch-log", { name: N100 }],            // 100 chars: agent>64 rejects, web<128 accepts
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
  ["run", { cmd: "rm -rf ~" }],             // not a verb
  ["", {}],
];

let mismatches = 0;
for (const [verb, args] of vectors) {
  const a = agentValidate(verb, args).ok === true;
  const w = webValidate(verb, args).ok === true;
  const tag = a === w ? "ok  " : "DIFF";
  if (a !== w) mismatches++;
  console.log(`${tag}  agent=${a ? "accept" : "reject"}  web=${w ? "accept" : "reject"}  ${verb} ${JSON.stringify(args)}`);
}

console.log(`\n${mismatches === 0 ? "PARITY OK" : `PARITY FAIL — ${mismatches} divergence(s)`}`);
process.exit(mismatches === 0 ? 0 : 1);
