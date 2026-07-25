import { NextResponse, type NextRequest } from "next/server";
import { applyDecision } from "@/lib/inbox/decisions";
import { isValidSessionId } from "@/lib/inbox/session-id";

export const dynamic = "force-dynamic";

// Authed via middleware.ts (see approve/route.ts's comment — same posture).
//
// Dismiss -> insert fleet_decisions(action='dismissed') -> flip session
// status to 'reviewed', same transition as approve. Distinct action so the
// audit trail (and the Inbox's "Recently decided" label) shows this was
// noise-dismissed, not approved. See lib/inbox/decisions.ts for the
// guard/ordering. CONTRACT NOTE: 'dismissed' is not yet in the live
// fleet_decisions.action check constraint — the sibling `hardening` session's
// migration adds it, applied by the planner at consolidation. Until then this
// route's insert is expected to fail (see lib/inbox/decisions.ts's
// insertError branch) — that's a known, expected-pending-migration state,
// not a bug in this route.

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!isValidSessionId(id)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  const result = await applyDecision(id, "dismissed", {});
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.httpStatus },
    );
  }

  return NextResponse.json(
    { ok: true, status: result.status },
    { headers: { "Cache-Control": "no-store" } },
  );
}
