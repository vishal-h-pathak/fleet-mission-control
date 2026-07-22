// Types for the framework-free decisions-core.mjs so TypeScript callers
// (lib/inbox/decisions.ts, the API routes) get full typing while the runtime
// file stays plain ESM (importable by the Node self-test with no build
// step). Keep in sync with decisions-core.mjs.

export type DecisionAction =
  | "approve_merge"
  | "redispatch_with_feedback"
  | "reject";

/** The two statuses an operator decision can move a session to. */
export type OperatorStatus = "reviewed" | "rejected";

export type ValidationResult =
  | { ok: true; feedback: string | null }
  | { ok: false; error: "invalid_action" | "feedback_required" };

/**
 * Maps a decision action to the `fleet_sessions.status` it drives, per
 * docs/SCHEMA_V2.md's operator-driven transitions table. Throws on an
 * unrecognized action.
 */
export declare function nextStatusForDecision(action: string): OperatorStatus;

/**
 * Validates a decision route's request body for a given action:
 * `redispatch_with_feedback` requires non-blank `feedback` (trimmed and
 * returned); `approve_merge`/`reject` require none. Rejects unknown actions.
 */
export declare function validateDecisionPayload(
  action: string,
  body: { feedback?: unknown },
): ValidationResult;
