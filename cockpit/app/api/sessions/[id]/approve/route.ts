import { NextResponse, type NextRequest } from "next/server";
import { applyDecision } from "@/lib/inbox/decisions";
import { isValidSessionId } from "@/lib/inbox/session-id";

export const dynamic = "force-dynamic";

// Authed via middleware.ts (this route is not in its exclusion list — see
// the matcher there). No auth check needed here; defense-in-depth would
// duplicate that gate, not add one, since there's no separate credential to
// re-verify (unlike web/'s cookie-token scheme).
//
// Approve -> insert fleet_decisions(action='approve_merge') -> flip session
// status to 'reviewed'. See lib/inbox/decisions.ts for the guard/ordering.

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!isValidSessionId(id)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  const result = await applyDecision(id, "approve_merge", {});
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
