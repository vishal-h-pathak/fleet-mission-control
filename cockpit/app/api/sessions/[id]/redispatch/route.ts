import { NextResponse, type NextRequest } from "next/server";
import { applyDecision } from "@/lib/inbox/decisions";
import { isValidSessionId } from "@/lib/inbox/session-id";

export const dynamic = "force-dynamic";

// Authed via proxy.ts (see approve/route.ts's comment — same posture).
//
// Redispatch with feedback -> insert
// fleet_decisions(action='redispatch_with_feedback', feedback=<text>) ->
// flip session status to 'reviewed'. See lib/inbox/decisions.ts for the
// guard/ordering and lib/inbox/decisions-core.mjs for feedback validation
// (required, non-blank, trimmed).

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!isValidSessionId(id)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const feedback =
    body && typeof body === "object" && "feedback" in body
      ? (body as { feedback?: unknown }).feedback
      : undefined;

  const result = await applyDecision(id, "redispatch_with_feedback", {
    feedback,
  });
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
