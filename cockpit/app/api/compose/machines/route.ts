import { NextResponse } from "next/server";
import { getMachines } from "@/lib/projects/data";

export const dynamic = "force-dynamic";

// Authed via proxy.ts. The per-chunk machine picker.
export async function GET() {
  try {
    const machines = await getMachines();
    return NextResponse.json(
      { machines },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    console.error("[api/compose/machines] query failed:", e);
    return NextResponse.json({ error: "machines_query_failed" }, { status: 500 });
  }
}
