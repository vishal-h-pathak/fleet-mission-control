// Canonical verb allowlist for fleet command dispatch — the SINGLE source of
// truth shared by BOTH the dashboard dispatch route (web) and the per-machine
// control agent (P2-A keeps agent/allowlist.mjs byte-for-byte identical; a
// parity test asserts equality at consolidation).
//
// Plain ESM (.mjs, zero deps) on purpose: the Node agent imports the exact same
// file the TypeScript route does, so the UI and the agent can never drift.
//
// SECURITY — non-negotiable:
//   * Only verbs in VERBS are accepted; anything else is "rejected".
//   * Args are whitelisted by name AND validated against a strict charset
//     (no shell metacharacters, no path traversal, no absolute paths).
//   * NEVER add a free-text / arbitrary-exec verb here. The agent maps each
//     verb to a fixed cockpit.sh primitive with escaped args.
//
// Keep this file in sync byte-for-byte with agent/allowlist.mjs.

/** Strict charsets. No shell metacharacters. */
const NAME_RE = /^[A-Za-z0-9._-]{1,128}$/;
const RELPATH_RE = /^[A-Za-z0-9._/-]{1,256}$/;

// Verb → spec. `args` lists the allowed arg names; any other key is rejected.
// Each verb maps (in the agent) to a fixed cockpit.sh primitive:
//   check     → cockpit.sh check
//   status    → cockpit.sh status
//   fetch-log → cockpit.sh fetch / peek <name>
//   pull      → cockpit.sh pull
//   artifact  → cockpit.sh artifact <relpath> [dest]
export const VERBS = {
  check: { args: [] },
  status: { args: [] },
  "fetch-log": {
    args: [{ name: "name", required: true, re: NAME_RE }],
  },
  pull: { args: [] },
  artifact: {
    args: [
      { name: "relpath", required: true, re: RELPATH_RE },
      { name: "dest", required: false, re: RELPATH_RE },
    ],
  },
};

export const ALLOWED_VERBS = Object.keys(VERBS);

export function isAllowedVerb(verb) {
  return Object.prototype.hasOwnProperty.call(VERBS, verb);
}

// Validate a dispatch request against the allowlist. Pure; no I/O.
// On success returns the normalized { verb, args } (only known args, all
// strings). On failure returns { ok: false, error } with a safe reason.
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
    if (!allowed.has(key)) {
      return { ok: false, error: `unexpected arg: ${key}` };
    }
  }

  const out = {};
  for (const a of spec.args) {
    const v = args[a.name];
    if (v == null || v === "") {
      if (a.required) return { ok: false, error: `missing arg: ${a.name}` };
      continue;
    }
    if (typeof v !== "string") {
      return { ok: false, error: `arg ${a.name} must be a string` };
    }
    if (!a.re.test(v)) {
      return { ok: false, error: `arg ${a.name} has invalid characters` };
    }
    if (v.includes("..")) {
      return { ok: false, error: `arg ${a.name} must not contain ".."` };
    }
    if (v.startsWith("/")) {
      return { ok: false, error: `arg ${a.name} must be a relative path` };
    }
    out[a.name] = v;
  }

  return { ok: true, verb, args: out };
}
