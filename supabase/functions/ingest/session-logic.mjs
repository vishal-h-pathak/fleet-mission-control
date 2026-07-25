// Fleet MCv2 — pure session-enrichment decision logic, shared by the ingest Edge
// Function (Deno) and its Node test (test/session-logic.test.mjs). No I/O, no jsr
// imports — just the transition table + match-ladder priority that the race matrix
// in docs/SCHEMA_V2.md is proven against. Keeping it here means index.ts and the
// test exercise the SAME code, not two drifting copies.

// Session lifecycle. Non-terminal rows are the enrichment/registration match set
// (mirrors fleet_sessions_active_uniq). Operator-terminal states are decisions the
// operator made in the cockpit and are never downgraded by a late telemetry record.
// `lost` (staleness sweep, pg_cron) is telemetry-terminal like `done` — deliberately
// NOT in SESSION_NONTERMINAL, so match-ladder tiers 2/3 skip it (a later record for
// the same machine+name starts a fresh session rather than reopening it), while tier
// 1 (job_id, no status filter) still finds it, letting a genuine late hook/backstop
// record flip it to `done` via nextSessionStatus below.
export const SESSION_NONTERMINAL = new Set(["planned", "running", "waiting"]);
export const SESSION_OPERATOR_TERMINAL = new Set(["reviewed", "merged", "rejected"]);
export const SESSION_STATUSES = [
  "planned", "running", "waiting", "done", "reviewed", "merged", "rejected", "lost",
];
export const WAVE_STATUSES = ["draft", "dispatched", "reviewing", "done", "abandoned"];

// Charset for names/projects accepted by ingest + registration. No spaces, no shell
// metacharacters — these are recorded, never executed, but strict anyway.
export const NAME_RE = /^[A-Za-z0-9._/-]{1,200}$/;

// The status a session moves to when a telemetry record arrives.
//   • operator-terminal (reviewed/merged/rejected) is sticky — a stray record can't
//     reopen a decision the operator already made.
//   • a terminal record (finished/failed/stopped) ⇒ done, even from `lost` — this is
//     the "genuine late hook/backstop record flips lost → done" case (only reachable
//     via the job_id-anchored tier 1 match, since lost is excluded from the
//     name/branch tiers).
//   • a running record ⇒ running, but never re-opens an already-`done` OR
//     already-`lost` session (guards against an out-of-order running heartbeat
//     arriving after the finish, or after the sweep already gave up on it).
export function nextSessionStatus(cur, isTerminal) {
  if (SESSION_OPERATOR_TERMINAL.has(cur)) return cur;
  if (isTerminal) return "done";
  if (cur === "done" || cur === "lost") return cur;
  return "running";
}

// The match-ladder PRIORITY: given the (already-resolved) candidate rows from each
// tier, pick the row to enrich. Returns { row, via } or { row: null } to create an
// ungrouped session. index.ts resolves the tiers lazily (short-circuit) but obeys
// exactly this order:
//   1. job_id           — the anchor; stable per lifecycle, fresh per new lifecycle.
//   2. (machine, name)  — a registered planned session, or a matching tmux name.
//   3. (machine, project, branch) — Terminal.app fallback (JOB_NAME = claude-<sid8>
//                          never matches the registered name; match the branch).
//   else create ungrouped.
export function pickSessionMatch({ byJobId, byName, byProjectBranch }) {
  if (byJobId) return { row: byJobId, via: "job_id" };
  if (byName) return { row: byName, via: "machine_name" };
  if (byProjectBranch) return { row: byProjectBranch, via: "machine_project_branch" };
  return { row: null, via: "create_ungrouped" };
}
