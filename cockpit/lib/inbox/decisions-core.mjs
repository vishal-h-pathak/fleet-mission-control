// Plain ESM, zero deps — mirrors lib/auth/allowlist.mjs / lib/inbox/group.mjs.
//
// Pure decision logic shared by the four decision API routes
// (app/api/sessions/[id]/{approve,redispatch,reject,dismiss}/route.ts). Zero
// I/O so it can be unit-tested against fixtures with no live Supabase
// project (see decisions-core.test.mjs). Encodes the status-transition table
// from docs/SCHEMA_V2.md's "operator-driven" section:
//   approve_merge             -> reviewed
//   redispatch_with_feedback  -> reviewed
//   reject                    -> rejected
//   dismissed                 -> reviewed  (noise-dismiss on an ungrouped
//                                 session — same transition as approve,
//                                 distinct label; the sibling `hardening`
//                                 session is adding 'dismissed' to the
//                                 fleet_decisions.action check constraint —
//                                 see the contract note in
//                                 ops/prompts/PROMPT_mcv2_waves_board.md)

/** @type {Record<import('./decisions-core.d.mts').DecisionAction, import('./decisions-core.d.mts').OperatorStatus>} */
const STATUS_FOR_ACTION = {
  approve_merge: "reviewed",
  redispatch_with_feedback: "reviewed",
  reject: "rejected",
  dismissed: "reviewed",
};

/**
 * @param {string} action
 * @returns {import('./decisions-core.d.mts').OperatorStatus}
 */
export function nextStatusForDecision(action) {
  const next = STATUS_FOR_ACTION[/** @type {any} */ (action)];
  if (!next) {
    throw new Error(`unknown decision action: ${String(action)}`);
  }
  return next;
}

/**
 * Validates a decision route's request body for a given action.
 *   - approve_merge / reject: no feedback required (any provided feedback is
 *     ignored — those two actions don't carry one, per the schema).
 *   - redispatch_with_feedback: feedback is required and must be non-blank
 *     after trimming; the trimmed value is what gets returned/stored.
 *
 * @param {string} action
 * @param {{ feedback?: unknown }} body
 * @returns {import('./decisions-core.d.mts').ValidationResult}
 */
export function validateDecisionPayload(action, body) {
  if (!Object.prototype.hasOwnProperty.call(STATUS_FOR_ACTION, action)) {
    return { ok: false, error: "invalid_action" };
  }

  if (action === "redispatch_with_feedback") {
    const raw = typeof body?.feedback === "string" ? body.feedback : "";
    const trimmed = raw.trim();
    if (!trimmed) {
      return { ok: false, error: "feedback_required" };
    }
    return { ok: true, feedback: trimmed };
  }

  return { ok: true, feedback: null };
}
