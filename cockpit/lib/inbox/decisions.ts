import "server-only";

import { getAdminClient } from "@/lib/supabase/admin";
import {
  nextStatusForDecision,
  validateDecisionPayload,
} from "./decisions-core.mjs";
import type { DecisionAction } from "./types";

// Server-only decision-writing module, shared by the three decision route
// handlers (app/api/sessions/[id]/{approve,redispatch,reject}/route.ts).
// Uses the service-role admin client — fleet_decisions and fleet_sessions are
// both RLS-private, deny-all tables (see docs/SCHEMA_V2.md).

export type ApplyDecisionResult =
  | { ok: true; status: "reviewed" | "rejected" }
  | { ok: false; error: string; httpStatus: number };

/**
 * Applies an operator decision to a session: validates the payload, flips
 * `fleet_sessions.status` per the transition table in docs/SCHEMA_V2.md
 * (guarded to only fire from `status = 'done'`), then appends the
 * `fleet_decisions` audit row.
 *
 * Ordering note (a deliberate, documented divergence from a literal
 * insert-then-update reading): the guarded status update runs FIRST, using
 * the same `.eq("status", "done")` WHERE-clause pattern already established
 * in web/app/api/command/[id]/approve/route.ts. That makes the update the
 * race-safe operation — a session can only be decided once, and a
 * double-click / two-tab race loses cleanly with `not_awaiting_review`
 * rather than writing two decisions for one transition. The append-only
 * `fleet_decisions` insert follows, recording the decision that actually
 * caused the flip.
 */
export async function applyDecision(
  sessionId: string,
  action: DecisionAction,
  body: { feedback?: unknown },
): Promise<ApplyDecisionResult> {
  const validation = validateDecisionPayload(action, body);
  if (!validation.ok) {
    return { ok: false, error: validation.error, httpStatus: 400 };
  }

  const supabase = getAdminClient();
  const nextStatus = nextStatusForDecision(action);

  const { data: updated, error: updateError } = await supabase
    .from("fleet_sessions")
    .update({ status: nextStatus })
    .eq("id", sessionId)
    .eq("status", "done")
    .select("id")
    .maybeSingle();

  if (updateError) {
    return { ok: false, error: "update_failed", httpStatus: 500 };
  }
  if (!updated) {
    // No row flipped -> it wasn't awaiting review (already decided, still
    // running, or doesn't exist).
    return { ok: false, error: "not_awaiting_review", httpStatus: 409 };
  }

  const { error: insertError } = await supabase.from("fleet_decisions").insert({
    session_id: sessionId,
    action,
    feedback: validation.feedback,
  });

  if (insertError) {
    // Status already flipped; the audit row failed. Surface distinctly so
    // this isn't confused with a plain failure — the human/Task 3 pass
    // should investigate rather than retry blindly (retrying would 409 on
    // the now-`not_awaiting_review` session).
    return { ok: false, error: "decision_insert_failed", httpStatus: 500 };
  }

  return { ok: true, status: nextStatus };
}
