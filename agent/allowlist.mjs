// Fleet Mission Control — verb allowlist (SHARED SOURCE OF TRUTH)
//
// SECURITY-CRITICAL. This is the entire authority over what the control plane may do.
// The agent (agent/index.mjs) and the dashboard's dispatch route (P2-B, web/) MUST enforce
// the IDENTICAL list. Because the two live in separate packages/branches (the web app cannot
// import outside its root on Vercel), P2-B keeps a byte-identical copy at
// web/lib/commands/allowlist.mjs and a consolidation parity test fails if they drift.
// => If you change a verb, arg, or regex here, change it there too.
//
// Hard rules (do not relax):
//   - The allowlist is closed: unknown verb => rejected, nothing runs.
//   - Args are whitelisted by strict charset. NEVER a denylist of "bad chars".
//   - There is NO `run` / arbitrary-exec verb. Never add one in this cut.
//   - Args are mapped to a cockpit.sh ARGV ARRAY (never a shell string). The caller must
//     spawn with shell:false. The charset whitelist below is the second line of defense
//     because cockpit.sh itself interpolates name/relpath into remote ssh commands.

// ── Arg charsets (whitelist only) ────────────────────────────────────────────
// tmux session / job name: letters, digits, dot, underscore, hyphen. 1–64 chars.
export const NAME_RE = /^[A-Za-z0-9._-]{1,64}$/;
// A single path segment (used to validate each part of a relative path).
export const PATH_SEGMENT_RE = /^[A-Za-z0-9._-]+$/;
// Max length for a whole relpath/dest, defensive.
const PATH_MAX = 256;

// Validate a relative path: no absolutes, no traversal, no shell metacharacters,
// every segment a safe token. Returns true only for a clean relative path.
export function isSafeRelPath(p) {
  if (typeof p !== "string" || p.length === 0 || p.length > PATH_MAX) return false;
  if (p.startsWith("/")) return false; // must be relative (resolved under WIN_BASE)
  if (p.startsWith("~")) return false; // no home expansion
  const segments = p.split("/");
  for (const seg of segments) {
    if (seg === "" ) return false;      // no "//" or trailing slash
    if (seg === "." || seg === "..") return false; // no traversal
    if (!PATH_SEGMENT_RE.test(seg)) return false;  // strict charset per segment
  }
  return true;
}

// ── The allowlist ────────────────────────────────────────────────────────────
// Each entry: validate(args) -> { ok, argv } | { ok:false, reason }
// argv is the exact array passed to cockpit.sh (argv[0] is the verb cockpit.sh expects).
export const VERBS = {
  check: {
    summary: "Is the box reachable?  (cockpit.sh check)",
    validate(args) {
      const e = noArgs(args);
      return e ? rej(e) : ok(["check"]);
    },
  },

  status: {
    summary: "List tmux sessions + last log line.  (cockpit.sh status)",
    validate(args) {
      const e = noArgs(args);
      return e ? rej(e) : ok(["status"]);
    },
  },

  "fetch-log": {
    summary: "Fetch a job log and print its tail.  (cockpit.sh peek <name>)",
    argSpec: { name: "required (job/tmux name)" },
    validate(args) {
      const a = asObject(args);
      if (!a) return rej("args must be an object");
      const extra = extraKeys(a, ["name"]);
      if (extra) return rej(extra);
      if (typeof a.name !== "string" || !NAME_RE.test(a.name)) {
        return rej("invalid 'name' (allowed: letters, digits, . _ - ; 1-64 chars)");
      }
      return ok(["peek", a.name]);
    },
  },

  pull: {
    summary: "git pull both repos on the Mac.  (cockpit.sh pull)",
    validate(args) {
      const e = noArgs(args);
      return e ? rej(e) : ok(["pull"]);
    },
  },

  artifact: {
    summary: "rsync a file/dir from the box.  (cockpit.sh artifact <relpath> [dest])",
    argSpec: { relpath: "required (relative path under WIN_BASE)", dest: "optional (relative local dest)" },
    validate(args) {
      const a = asObject(args);
      if (!a) return rej("args must be an object");
      const extra = extraKeys(a, ["relpath", "dest"]);
      if (extra) return rej(extra);
      if (!isSafeRelPath(a.relpath)) {
        return rej("invalid 'relpath' (must be a clean relative path: no '..', no leading '/', safe charset)");
      }
      if (a.dest !== undefined && a.dest !== null && a.dest !== "") {
        if (!isSafeRelPath(a.dest)) {
          return rej("invalid 'dest' (must be a clean relative path: no '..', no leading '/', safe charset)");
        }
        return ok(["artifact", a.relpath, a.dest]);
      }
      return ok(["artifact", a.relpath]);
    },
  },
};

// ── Top-level validation ─────────────────────────────────────────────────────
// validateCommand(verb, args) -> { ok:true, argv:[...] } | { ok:false, reason:"..." }
export function validateCommand(verb, args) {
  if (typeof verb !== "string" || !Object.prototype.hasOwnProperty.call(VERBS, verb)) {
    return rej(`unknown verb '${verb}' — not in allowlist`);
  }
  return VERBS[verb].validate(args);
}

export function isAllowedVerb(verb) {
  return typeof verb === "string" && Object.prototype.hasOwnProperty.call(VERBS, verb);
}

export const ALLOWED_VERBS = Object.keys(VERBS);

// ── Helpers ──────────────────────────────────────────────────────────────────
function ok(argv) {
  return { ok: true, argv };
}
function rej(reason) {
  return { ok: false, reason };
}
function asObject(args) {
  if (args === undefined || args === null) return {};
  if (typeof args !== "object" || Array.isArray(args)) return null;
  return args;
}
// For zero-arg verbs: tolerate undefined/null/{} but reject any provided keys.
function noArgs(args) {
  const a = asObject(args);
  if (!a) return "args must be an object";
  const keys = Object.keys(a);
  if (keys.length) return `verb takes no args (got: ${keys.join(", ")})`;
  return null;
}
function extraKeys(a, allowed) {
  const extra = Object.keys(a).filter((k) => !allowed.includes(k));
  return extra.length ? `unexpected arg key(s): ${extra.join(", ")}` : null;
}
