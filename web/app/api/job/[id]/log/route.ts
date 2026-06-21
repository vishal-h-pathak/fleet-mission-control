import { NextResponse, type NextRequest } from "next/server";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth";
import { getServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Authed, server-only. Returns the SENSITIVE log_tail for one job from the
// private fleet_job_links table using the service-role key. Logs can leak
// arbitrary content, so this is gated exactly like the /rc links route: by
// middleware AND re-verified here as defense-in-depth — never reachable unauthed.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ok = await verifySessionToken(req.cookies.get(COOKIE_NAME)?.value);
  if (!ok) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "missing_id" }, { status: 400 });
  }

  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("fleet_job_links")
    .select("job_id, log_tail")
    .eq("job_id", id)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: "query_failed", message: error.message },
      { status: 500 },
    );
  }
  if (!data) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json(
    { job_id: data.job_id, log_tail: data.log_tail },
    { headers: { "Cache-Control": "no-store" } },
  );
}
