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
    // Status already flipped; the audit row failed. Best-effort compensate:
    // flip the session back to 'done' so it doesn't get stuck in a terminal
    // state with no fleet_decisions row to explain how it got there — a
    // second, guarded UPDATE (only touches the row if it's still sitting in
    // `nextStatus`, i.e. the one we just wrote) is within reach of the
    // Supabase REST client, unlike a real fix. Residual race window (why
    // this is "best-effort", not a real fix): this compensating update is
    // NOT atomic with the failed insert above. If some other write — another
    // decision request, a late ingest record — touches this exact row in the
    // gap between our update succeeding and this one running, this could
    // clobber that write instead of just our own. A real fix needs both
    // writes wrapped in one Postgres transaction (a `supabase.rpc(...)`
    // stored procedure), which is out of scope for this task. If the
    // compensating update itself fails (or the row moved and the guard
    // no-ops), we're left with the original gap: session stuck in
    // `nextStatus`, no decision row — surfaced via the distinct 500 below so
    // a human notices and investigates rather than the caller retrying
    // blindly (a retry would just 409 on the now-non-'done' session).
    await supabase
      .from("fleet_sessions")
      .update({ status: "done" })
      .eq("id", sessionId)
      .eq("status", nextStatus);

    return { ok: false, error: "decision_insert_failed", httpStatus: 500 };
  }

  return { ok: true, status: nextStatus };
}
