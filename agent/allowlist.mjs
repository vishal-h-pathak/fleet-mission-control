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
//   - There is NO arbitrary-exec verb. `run` delegates a natural-language GOAL to Claude on
//     the box (base64-encoded so it crosses ssh/tmux with zero quoting surface) — never a
//     shell string. Powerful verbs (`run`, `nav`) carry requiresApproval:true and are gated
//     by an explicit human approval (enforced server-side AND in the agent — see index.mjs).
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

// ── `run` directive (delegated GOAL, not a shell string) ─────────────────────
// The fixed set of repos a delegated session may run in. Closed list, never widened here.
export const RUN_REPOS = ["cellular-gaits", "portfolio"];
// Max directive length. The directive is base64-encoded before it crosses ssh/tmux, so it
// needs NO restrictive charset — but we still cap length and reject ANY control char
// (codepoint < 0x20, incl. \n \r \t \0, and 0x7f DEL) so nothing can smuggle a newline into
// the remote command or a NUL past the decoder.
const DIRECTIVE_MAX = 2000;
// eslint-disable-next-line no-control-regex
const CONTROL_CHAR_RE = /[\x00-\x1f\x7f]/;
// Validate a delegated directive. Returns true only for a clean, length-capped string.
export function isSafeDirective(s) {
  if (typeof s !== "string" || s.length === 0 || s.length > DIRECTIVE_MAX) return false;
  if (CONTROL_CHAR_RE.test(s)) return false; // no newlines / control chars / NULs
  return true;
}

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
// Each entry: { requiresApproval, validate(args) -> { ok, argv } | { ok:false, reason } }
// argv is the exact array passed to cockpit.sh (argv[0] is the verb cockpit.sh expects).
// requiresApproval:true verbs are MUTATING/powerful — the agent refuses to execute them
// unless the claimed row carries a non-null approved_at (defense-in-depth; see index.mjs).
export const VERBS = {
  check: {
    summary: "Is the box reachable?  (cockpit.sh check)",
    requiresApproval: false,
    validate(args) {
      const e = noArgs(args);
      return e ? rej(e) : ok(["check"]);
    },
  },

  status: {
    summary: "List tmux sessions + last log line.  (cockpit.sh status)",
    requiresApproval: false,
    validate(args) {
      const e = noArgs(args);
      return e ? rej(e) : ok(["status"]);
    },
  },

  "fetch-log": {
    summary: "Fetch a job log and print its tail.  (cockpit.sh peek <name>)",
    requiresApproval: false,
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
    requiresApproval: false,
    validate(args) {
      const e = noArgs(args);
      return e ? rej(e) : ok(["pull"]);
    },
  },

  artifact: {
    summary: "rsync a file/dir from the box.  (cockpit.sh artifact <relpath> [dest])",
    requiresApproval: false,
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

  // ── Phase C action verbs ─────────────────────────────────────────────────
  morning: {
    summary: "Resync: fetch sentry logs + git-pull both Mac repos + status.  (cockpit.sh morning)",
    requiresApproval: false, // read/resync only — the cellular-gaits resume trigger
    validate(args) {
      const e = noArgs(args);
      return e ? rej(e) : ok(["morning"]);
    },
  },

  nav: {
    summary: "Start the paused navigation run.  (cockpit.sh nav)",
    requiresApproval: true, // mutating: launches a long compute job on the box
    validate(args) {
      const e = noArgs(args);
      return e ? rej(e) : ok(["nav"]);
    },
  },

  run: {
    summary: "Delegate a natural-language GOAL to Claude on the box.  (cockpit.sh run-b64 <repo> <b64>)",
    requiresApproval: true, // mutating: spawns a bypassPermissions Claude session
    argSpec: { repo: "required (one of: " + RUN_REPOS.join(", ") + ")", directive: "required (natural-language goal, ≤2000 chars, no control chars)" },
    validate(args) {
      const a = asObject(args);
      if (!a) return rej("args must be an object");
      const extra = extraKeys(a, ["repo", "directive"]);
      if (extra) return rej(extra);
      if (typeof a.repo !== "string" || !RUN_REPOS.includes(a.repo)) {
        return rej(`invalid 'repo' (must be one of: ${RUN_REPOS.join(", ")})`);
      }
      if (!isSafeDirective(a.directive)) {
        return rej("invalid 'directive' (required string, 1-2000 chars, no control chars / newlines / NULs)");
      }
      // Base64-encode the directive so it crosses ssh/tmux with ZERO quoting/injection
      // surface; cockpit.sh `run-b64` decodes it on the box with `base64 -d` (never eval).
      const b64 = Buffer.from(a.directive, "utf-8").toString("base64");
      return ok(["run-b64", a.repo, b64]);
    },
  },
};

// Does this verb require an explicit human approval before the agent will execute it?
export function verbRequiresApproval(verb) {
  return isAllowedVerb(verb) && VERBS[verb].requiresApproval === true;
}

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
