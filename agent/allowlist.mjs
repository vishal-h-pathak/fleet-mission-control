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

// ─────────────────────────────────────────────────────────────────────────────
// MCv2 M4 — WAVE LAUNCH (`run-wave`) VALIDATION GAUNTLET
// ─────────────────────────────────────────────────────────────────────────────
// SECURITY-CRITICAL, and a DIFFERENT threat model from the verbs above: a wave
// session arrives from the `dispatch` Edge Function and turns a web click into
// `claude --permission-mode bypassPermissions` running on this box. SCHEMA_V2
// invariant (d) is explicit — **the bus is untrusted input to the agent**. A
// compromised or merely buggy bus row must not be sufficient to run code, so
// every field is revalidated here against hard-coded local truth before any
// process is spawned. Nothing free-text from the bus ever reaches an argv or a
// directive: the directive is composed from a fixed template (composeDirective)
// parameterized ONLY by fields that survived this gauntlet.
//
// Hard rules (same regime as the verbs, no exceptions):
//   - The repo set is a CLOSED, hard-coded map. Unknown repo => reject-ack.
//   - Every string is charset-whitelisted, never denylisted.
//   - No value may begin with '-' (argv flag injection) or contain '..' (traversal).
//   - The worktree path is COMPUTED here from validated parts. The bus's own
//     `worktree` and `directive` fields are IGNORED for execution — record-only.

// The fixed set of repos a wave may launch in, mapped to this machine's layout.
// `checkout` and `worktreeRoot` are BOTH hard-coded per repo rather than derived
// from the repo slug: the real on-disk roots are irregular (fleet-mission-control
// worktrees live in `fleet-wt/`, not `fleet-mission-control-wt/`), and guessing a
// path that turns into `git worktree add` is exactly the kind of string surgery
// this file exists to prevent. Both are relative to FLEET_REPO_ROOT.
export const LAUNCH_REPOS = Object.freeze({
  "vishal-h-pathak/fleet-mission-control": Object.freeze({ checkout: "fleet-mission-control", worktreeRoot: "fleet-wt" }),
  "vishal-h-pathak/portfolio":             Object.freeze({ checkout: "portfolio",             worktreeRoot: "portfolio-wt" }),
  "vishal-h-pathak/jobify":                Object.freeze({ checkout: "jobify",                worktreeRoot: "jobify-wt" }),
  "vishal-h-pathak/caddiehack":            Object.freeze({ checkout: "caddiehack",            worktreeRoot: "caddiehack-wt" }),
  "vishal-h-pathak/cellular-gaits":        Object.freeze({ checkout: "cellular-gaits",        worktreeRoot: "cellular-gaits-wt" }),
});
export const LAUNCH_REPO_SLUGS = Object.freeze(Object.keys(LAUNCH_REPOS));

// Models a wave may request. Closed set — anything else is a reject, not a default.
export const LAUNCH_MODELS = Object.freeze(["haiku", "sonnet", "opus"]);

// Wave statuses from which the agent will launch. Mirrors WAVE_LAUNCHABLE in
// supabase/functions/dispatch/dispatch-logic.mjs — revalidated locally because
// the bus is untrusted (a poll response claiming an `abandoned` wave is refused
// here even if the function that produced it was compromised).
export const LAUNCH_WAVE_STATUSES = Object.freeze(["confirmed", "launching"]);

// Only `planned` work is launchable. Anything else already ran or was decided.
export const LAUNCH_SESSION_STATUS = "planned";

// The ONLY session fields the launch path consumes. Asserted in the parity check
// to be a subset of the dispatch function's POLL_SESSION_FIELDS and disjoint from
// POLL_FORBIDDEN_FIELDS — a mechanical guarantee that `directive`, `last_message`,
// `rc_url` and `pr_url` can never become launch inputs.
export const LAUNCH_CONSUMED_FIELDS = Object.freeze(["id", "name", "repo", "branch", "model", "prompt_ref"]);

// Session ids are uuids (they cross into JSON bodies, never argv, but a closed
// shape here keeps a malformed id from ever reaching the bus as a claim/ack).
export const LAUNCH_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Committed prompts only, and only from the reviewed prompt directory. `/` is
// outside the charset, so traversal cannot be expressed at all; the explicit
// '..' check below is belt-and-braces.
export const PROMPT_REF_RE = /^ops\/prompts\/PROMPT_[A-Za-z0-9_.-]{1,120}\.md$/;

const BRANCH_MAX = 100;

// A git branch the agent will hand to `git worktree add`. Slash-separated
// segments, each a safe token; no leading '-' (flag injection), no '..', and
// none of git's own ref-name traps (leading dot, trailing .lock, bare HEAD).
export function isSafeBranch(b) {
  if (typeof b !== "string" || b.length === 0 || b.length > BRANCH_MAX) return false;
  if (b.startsWith("-")) return false;                   // argv flag injection
  if (b.startsWith("/") || b.endsWith("/")) return false;
  if (b.includes("..")) return false;                    // traversal / invalid ref
  if (b === "HEAD") return false;
  for (const seg of b.split("/")) {
    if (!PATH_SEGMENT_RE.test(seg)) return false;        // strict charset, non-empty
    if (seg === "." || seg === "..") return false;
    if (seg.startsWith("-") || seg.startsWith(".")) return false;
    if (seg.endsWith(".lock")) return false;             // git refuses these refs
  }
  return true;
}

// A session name. Becomes the tmux session name (so ingest's rung-2
// `(machine_id, name)` match binds the launched process to the planned row) AND
// the last path segment of the computed worktree — so it must be safe as both.
export function isSafeSessionName(n) {
  if (typeof n !== "string" || !NAME_RE.test(n)) return false; // charset + 1..64
  if (n.startsWith("-")) return false;                   // argv flag injection
  if (n.startsWith(".")) return false;                   // no dotfile worktrees
  if (n.includes("..")) return false;
  return true;
}

// A prompt path inside the repo. Verified to EXIST in origin/main at execution
// time by the caller — this is only the shape check.
export function isSafePromptRef(p) {
  if (typeof p !== "string" || !PROMPT_REF_RE.test(p)) return false;
  if (p.includes("..")) return false;
  return true;
}

// ── The directive template — the one and only thing a launched session is told ──
// Parameterized by validated fields ONLY. `fleet_sessions.directive` (free text,
// operator-authored, transported nowhere) never reaches this function: SCHEMA_V2
// invariant (c). Covered by a unit test that asserts the exact rendered string.
export function composeDirective({ promptRef, branch }) {
  if (!isSafePromptRef(promptRef)) return rej("invalid 'prompt_ref' for directive");
  if (!isSafeBranch(branch)) return rej("invalid 'branch' for directive");
  const directive =
    `Read ./ops/prompts/PROMPT_fleet_conventions.md then ./${promptRef} ` +
    `and implement it on this branch (${branch}). Validate, then STOP and report. ` +
    `Do not begin until the operator confirms.`;
  // The seed is typed into a TUI as ONE line: a newline would submit early and a
  // control char could corrupt the pane. isSafeDirective enforces exactly that.
  if (!isSafeDirective(directive)) return rej("composed directive failed the directive validator");
  return { ok: true, directive };
}

// ── The gauntlet ─────────────────────────────────────────────────────────────
// validateLaunchSession({ session, wave, repoRoot })
//   -> { ok:true, plan:{...} } | { ok:false, reason:"..." }
// `plan` is fully computed: nothing downstream re-derives a path or a string from
// bus data. A rejection's `reason` is safe to store (it quotes untrusted values
// only through q(), truncated and control-char-stripped).
export function validateLaunchSession({ session, wave, repoRoot } = {}) {
  const s = asObject(session);
  if (!s || session === undefined || session === null) return rej("session must be an object");
  if (typeof repoRoot !== "string" || !repoRoot.startsWith("/") || repoRoot.includes("..")) {
    return rej("FLEET_REPO_ROOT must be a clean absolute path");
  }

  const { id, name, repo, branch, model } = s;
  const promptRef = s.prompt_ref;

  if (typeof id !== "string" || !LAUNCH_UUID_RE.test(id)) return rej(`invalid session 'id' ${q(id)} (expected a uuid)`);

  // (1) Wave must be one the agent is willing to act on at all.
  const w = asObject(wave);
  if (!w || wave === undefined || wave === null) return rej("wave must be an object");
  if (typeof w.status !== "string" || !LAUNCH_WAVE_STATUSES.includes(w.status)) {
    return rej(`wave status ${q(w.status)} is not launchable (expected one of: ${LAUNCH_WAVE_STATUSES.join(", ")})`);
  }

  // (2) Repo ∈ the hard-coded fixed set.
  if (typeof repo !== "string" || !Object.prototype.hasOwnProperty.call(LAUNCH_REPOS, repo)) {
    return rej(`repo ${q(repo)} is not in the fixed launch set (${LAUNCH_REPO_SLUGS.join(", ")})`);
  }
  // …and it must agree with the wave's own project registry entry when the poll
  // supplies one (the cross-check invariant (d) provisions that field for).
  const waveRepo = w.project && typeof w.project === "object" ? w.project.repo : undefined;
  if (waveRepo !== undefined && waveRepo !== null && waveRepo !== repo) {
    return rej(`session repo ${q(repo)} does not match the wave project repo ${q(waveRepo)}`);
  }

  // (3) Name / branch / model / prompt_ref charsets.
  if (!isSafeSessionName(name)) {
    return rej(`invalid session 'name' ${q(name)} (letters, digits, . _ - ; 1-64; no leading '-' or '.')`);
  }
  if (!isSafeBranch(branch)) {
    return rej(`invalid 'branch' ${q(branch)} (safe segments, no leading '-', no '..', ≤${BRANCH_MAX} chars)`);
  }
  if (typeof model !== "string" || !LAUNCH_MODELS.includes(model)) {
    return rej(`invalid 'model' ${q(model)} (must be one of: ${LAUNCH_MODELS.join(", ")})`);
  }
  if (!isSafePromptRef(promptRef)) {
    return rej(`invalid 'prompt_ref' ${q(promptRef)} (must match ${PROMPT_REF_RE.source})`);
  }

  // (4) The directive is COMPOSED, never carried.
  const d = composeDirective({ promptRef, branch });
  if (!d.ok) return d;

  // (5) Paths are computed from validated parts — never taken from the payload.
  const entry = LAUNCH_REPOS[repo];
  const repoDir = joinAbs(repoRoot, entry.checkout);
  const worktreePath = joinAbs(repoRoot, entry.worktreeRoot, name);

  return {
    ok: true,
    plan: Object.freeze({
      id,
      name,
      repo,
      branch,
      model,
      promptRef,
      repoDir,
      worktreePath,
      directive: d.directive,
      waveId: typeof w.id === "string" ? w.id : null,
      waveName: typeof w.name === "string" && isSafeSessionName(w.name) ? w.name : null,
    }),
  };
}

// Join already-validated path parts. Deliberately NOT node:path — every part has
// passed a charset whitelist, so this is a pure string join with no normalization
// surface (and it keeps this file import-free, as the web-side copy requires).
function joinAbs(root, ...parts) {
  const base = root.endsWith("/") ? root.slice(0, -1) : root;
  return [base, ...parts].join("/");
}

// Quote an untrusted value for a rejection reason: stringified, truncated, and
// stripped of control characters so a hostile payload cannot smuggle newlines
// into a log line or an ack body.
function q(v) {
  const s = typeof v === "string" ? v : v === undefined ? "undefined" : JSON.stringify(v) ?? String(v);
  // eslint-disable-next-line no-control-regex
  return JSON.stringify(String(s).slice(0, 80).replace(/[\x00-\x1f\x7f]/g, "?"));
}

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
