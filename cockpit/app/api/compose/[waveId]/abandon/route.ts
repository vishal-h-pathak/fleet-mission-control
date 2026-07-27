import { NextResponse, type NextRequest } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Authed via proxy.ts (same posture as the decision routes — no separate
// credential to re-verify here, unlike confirm/route.ts's execution-trigger
// write). Compose's Abandon button per
// ops/prompts/PROMPT_mcv2_compose.md §3 is scoped to pre-launch waves only:
// `draft` or `confirmed`. Abandoning a `launching`/`dispatched` wave mid-flight
// (docs/SCHEMA_V2.md's "any -> abandoned" kill switch) is left to the Waves
// board surface, not built here.
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ waveId: string }> },
) {
  const { waveId } = await params;
  if (!UUID_RE.test(waveId)) {
    return NextResponse.json({ error: "invalid_wave_id" }, { status: 400 });
  }

  const supabase = getAdminClient();
  const { data: updated, error } = await supabase
    .from("fleet_waves")
    .update({ status: "abandoned", updated_at: new Date().toISOString() })
    .eq("id", waveId)
    .in("status", ["draft", "confirmed"])
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[api/compose/abandon] update failed:", error);
    return NextResponse.json({ error: "abandon_failed" }, { status: 500 });
  }
  if (!updated) {
    return NextResponse.json({ error: "not_abandonable" }, { status: 409 });
  }

  return NextResponse.json(
    { ok: true, status: "abandoned" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
