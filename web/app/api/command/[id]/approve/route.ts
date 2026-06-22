import { NextResponse, type NextRequest } from "next/server";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth";
import { getServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Authed, server-only. The APPROVAL GATE: flips a single 'awaiting_approval'
// command to 'pending' (the only status the agent will claim) and stamps
// approved_by/approved_at. Gated by middleware; re-verified here as
// defense-in-depth so it is never reachable unauthed. The status guard is in
// the WHERE clause — a row that is not 'awaiting_approval' is never mutated,
// so approve is idempotent-safe and can't resurrect a rejected/done command.

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
    .update({
      status: "pending",
      approved_by: "dashboard",
      approved_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("status", "awaiting_approval")
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
    // No row flipped → it wasn't awaiting approval (already approved/rejected/gone).
    return NextResponse.json(
      { error: "not_awaiting_approval" },
      { status: 409 },
    );
  }

  return NextResponse.json(
    { command: data },
    { headers: { "Cache-Control": "no-store" } },
  );
}
