import { NextResponse, type NextRequest } from "next/server";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth";
import { getServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Authed, server-only. Returns recent fleet_commands rows + their status/result
// for the dispatch UI to poll (fleet_commands is deny-all to anon and NOT in the
// realtime publication, so the panel polls this route instead of subscribing).
// Gated by middleware; re-verified here as defense-in-depth — never unauthed.

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export async function GET(req: NextRequest) {
  const ok = await verifySessionToken(req.cookies.get(COOKIE_NAME)?.value);
  if (!ok) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const machineId = searchParams.get("machine_id");
  if (!machineId || !UUID_RE.test(machineId)) {
    return NextResponse.json({ error: "invalid_machine_id" }, { status: 400 });
  }

  const limitParamRaw = searchParams.get("limit");
  let limit = DEFAULT_LIMIT;
  if (limitParamRaw != null) {
    const n = Number.parseInt(limitParamRaw, 10);
    if (Number.isFinite(n) && n > 0) limit = Math.min(n, MAX_LIMIT);
  }

  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("fleet_commands")
    .select(
      "id, machine_id, verb, args, status, requested_by, created_at, claimed_at, finished_at, result, exit_code",
    )
    .eq("machine_id", machineId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json(
      { error: "query_failed", message: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json(
    { commands: data ?? [] },
    { headers: { "Cache-Control": "no-store" } },
  );
}
