// Canonical verb allowlist for fleet command dispatch (web/dashboard side).
//
// The validation RULES here are behaviorally IDENTICAL to agent/allowlist.mjs — the parity
// test scripts/check-allowlist-parity.mjs asserts the two agree on every accept/reject and
// fails the build/consolidation if they drift. The two files keep DIFFERENT return shapes by
// design (the agent returns the cockpit.sh argv it will execute; this returns the normalized
// {verb,args} the dispatch route inserts). The thing that must never drift is the SET OF
// ACCEPTED INPUTS — that's what the parity test guards.
//
// SECURITY — non-negotiable:
//   * Only verbs in VERBS are accepted; anything else is rejected.
//   * Args are whitelisted by strict charset; no shell metacharacters, no path traversal,
//     no absolute paths, no '~' expansion. NEVER add a free-text / arbitrary-exec verb.
//   * If you change a charset/length/path rule here, change agent/allowlist.mjs identically.

// ── Arg charsets (whitelist only) — IDENTICAL to agent/allowlist.mjs ──────────
// tmux session / job name: letters, digits, dot, underscore, hyphen. 1–64 chars.
const NAME_RE = /^[A-Za-z0-9._-]{1,64}$/;
// A single path segment.
const PATH_SEGMENT_RE = /^[A-Za-z0-9._-]+$/;
const PATH_MAX = 256;

// `run` args. The repo is a CLOSED set (never free-text); the directive is a
// bounded, control-char-free string. Keep these identical to agent/allowlist.mjs.
export const RUN_REPOS = ["cellular-gaits", "portfolio"];
const DIRECTIVE_MAX = 2000;
// C0 controls (incl. newline/tab) and DEL — disallowed so a directive is a
// single safe line and can never smuggle terminal/log-injection sequences.
function hasControlChar(s) {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c <= 0x1f || c === 0x7f) return true;
  }
  return false;
}

function isValidDirective(s) {
  return (
    typeof s === "string" &&
    s.length >= 1 &&
    s.length <= DIRECTIVE_MAX &&
    !hasControlChar(s)
  );
}

// Validate a relative path: no absolutes, no '~', no traversal, no shell metacharacters,
// every segment a safe token. Same logic as agent/allowlist.mjs::isSafeRelPath.
function isSafeRelPath(p) {
  if (typeof p !== "string" || p.length === 0 || p.length > PATH_MAX) return false;
  if (p.startsWith("/")) return false; // must be relative
  if (p.startsWith("~")) return false; // no home expansion
  const segments = p.split("/");
  for (const seg of segments) {
    if (seg === "") return false;                 // no "//", no trailing slash
    if (seg === "." || seg === "..") return false; // no traversal
    if (!PATH_SEGMENT_RE.test(seg)) return false;  // strict charset per segment
  }
  return true;
}

// Verb → arg spec. `args` lists allowed arg names; any other key is rejected.
// `kind` selects the validator: "name" (NAME_RE), "relpath" (isSafeRelPath),
// "repo" (RUN_REPOS membership) or "directive" (bounded, control-char-free).
// `requiresApproval`: powerful, mutating verbs land as 'awaiting_approval' and
// need a second authed Approve before the agent (which only claims 'pending')
// can pick them up. This flag MUST match agent/allowlist.mjs verb-for-verb.
// Each verb maps (in the agent) to a fixed cockpit.sh primitive:
//   check → check · status → status · fetch-log → peek <name> ·
//   pull → pull · artifact → artifact <relpath> [dest] ·
//   morning → morning · nav → nav · run → run <repo> <directive>
export const VERBS = {
  check: { requiresApproval: false, args: [] },
  status: { requiresApproval: false, args: [] },
  "fetch-log": {
    requiresApproval: false,
    args: [{ name: "name", required: true, kind: "name" }],
  },
  pull: { requiresApproval: false, args: [] },
  artifact: {
    requiresApproval: false,
    args: [
      { name: "relpath", required: true, kind: "relpath" },
      { name: "dest", required: false, kind: "relpath" },
    ],
  },
  morning: { requiresApproval: false, args: [] },
  nav: { requiresApproval: true, args: [] },
  run: {
    requiresApproval: true,
    args: [
      { name: "repo", required: true, kind: "repo", options: RUN_REPOS },
      { name: "directive", required: true, kind: "directive", maxLen: DIRECTIVE_MAX },
    ],
  },
};

export const ALLOWED_VERBS = Object.keys(VERBS);

export function isAllowedVerb(verb) {
  return Object.prototype.hasOwnProperty.call(VERBS, verb);
}

// True iff the verb is allowlisted AND flagged as requiring a second authed
// approval. Closed-by-default: unknown verbs are never "approval-required".
export function requiresApproval(verb) {
  return isAllowedVerb(verb) && VERBS[verb].requiresApproval === true;
}

function validArg(kind, v) {
  if (typeof v !== "string") return false;
  if (kind === "name") return NAME_RE.test(v);
  if (kind === "relpath") return isSafeRelPath(v);
  if (kind === "repo") return RUN_REPOS.includes(v);
  if (kind === "directive") return isValidDirective(v);
  return false;
}

// Validate a dispatch request against the allowlist. Pure; no I/O.
// Success → { ok:true, verb, args } (only known args, all strings).
// Failure → { ok:false, error } with a safe reason.
export function validateCommand(verb, rawArgs) {
  if (typeof verb !== "string" || !isAllowedVerb(verb)) {
    return { ok: false, error: `verb not allowed: ${String(verb)}` };
  }
  const spec = VERBS[verb];

  const args = rawArgs == null ? {} : rawArgs;
  if (typeof args !== "object" || Array.isArray(args)) {
    return { ok: false, error: "args must be an object" };
  }

  const allowed = new Set(spec.args.map((a) => a.name));
  for (const key of Object.keys(args)) {
    if (!allowed.has(key)) return { ok: false, error: `unexpected arg: ${key}` };
  }

  const out = {};
  for (const a of spec.args) {
    const v = args[a.name];
    if (v == null || v === "") {
      if (a.required) return { ok: false, error: `missing arg: ${a.name}` };
      continue;
    }
    if (!validArg(a.kind, v)) {
      return { ok: false, error: `arg ${a.name} has invalid value` };
    }
    out[a.name] = v;
  }

  return { ok: true, verb, args: out };
}
