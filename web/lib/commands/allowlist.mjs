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
// `kind` selects the validator: "name" (NAME_RE) or "relpath" (isSafeRelPath).
// Each verb maps (in the agent) to a fixed cockpit.sh primitive:
//   check → check · status → status · fetch-log → peek <name> ·
//   pull → pull · artifact → artifact <relpath> [dest]
export const VERBS = {
  check: { args: [] },
  status: { args: [] },
  "fetch-log": { args: [{ name: "name", required: true, kind: "name" }] },
  pull: { args: [] },
  artifact: {
    args: [
      { name: "relpath", required: true, kind: "relpath" },
      { name: "dest", required: false, kind: "relpath" },
    ],
  },
};

export const ALLOWED_VERBS = Object.keys(VERBS);

export function isAllowedVerb(verb) {
  return Object.prototype.hasOwnProperty.call(VERBS, verb);
}

function validArg(kind, v) {
  if (typeof v !== "string") return false;
  if (kind === "name") return NAME_RE.test(v);
  if (kind === "relpath") return isSafeRelPath(v);
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
