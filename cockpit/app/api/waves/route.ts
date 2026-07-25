import { NextResponse } from "next/server";
import { getMachineRail, getWavesBoard } from "@/lib/waves/data";

export const dynamic = "force-dynamic";

// Authed via proxy.ts (not in its exclusion list). Polled by the client-side
// Waves view (app/waves/waves-view.tsx) every ~12s — same cadence and
// pattern as the Inbox's /api/inbox (see app/api/inbox/route.ts).
export async function GET() {
  try {
    const [projects, machines] = await Promise.all([
      getWavesBoard(),
      getMachineRail(),
    ]);
    return NextResponse.json(
      { projects, machines },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    // Log server-side only — generic response body, no DB internals leaked.
    console.error("[api/waves] query failed:", e);
    return NextResponse.json({ error: "waves_query_failed" }, { status: 500 });
  }
}
