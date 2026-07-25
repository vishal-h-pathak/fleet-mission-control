import { NextResponse, type NextRequest } from "next/server";
import { applyDecision } from "@/lib/inbox/decisions";
import { isValidSessionId } from "@/lib/inbox/session-id";

export const dynamic = "force-dynamic";

// Authed via proxy.ts (see approve/route.ts's comment — same posture).
//
// Reject -> insert fleet_decisions(action='reject') -> flip session status
// to 'rejected'. See lib/inbox/decisions.ts for the guard/ordering.

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!isValidSessionId(id)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  const result = await applyDecision(id, "reject", {});
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
