import { NextResponse, type NextRequest } from "next/server";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth";
import { getServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Authed, server-only. Rejects a command: an 'awaiting_approval' row the human
// declines to approve, OR a 'pending' row not yet claimed by the agent. Either
// way it becomes 'rejected' and the agent will never claim it (it only claims
// 'pending', and the WHERE clause excludes already-claimed/running/done rows).
// Gated by middleware; re-verified here as defense-in-depth.

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ok = await verifySessionToken(req.cookies.get(COOKIE_NAME)?.value);
  if (!ok) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (typeof id !== "string" || !UUID_RE.test(id)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("fleet_commands")
    .update({ status: "rejected" })
    .eq("id", id)
    .in("status", ["awaiting_approval", "pending"])
    .select(
      "id, machine_id, verb, args, status, requested_by, approved_by, approved_at, created_at",
    )
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: "update_failed", message: error.message },
      { status: 500 },
    );
  }
  if (!data) {
    // Nothing flipped → not in a rejectable state (already claimed/done/rejected).
    return NextResponse.json(
      { error: "not_rejectable" },
      { status: 409 },
    );
  }

  return NextResponse.json(
    { command: data },
    { headers: { "Cache-Control": "no-store" } },
  );
}
