import { NextResponse } from "next/server";
import { getInboxGroups } from "@/lib/inbox/data";

export const dynamic = "force-dynamic";

// Authed via proxy.ts (not in its exclusion list). Polled by the
// client-side Inbox view (app/inbox-view.tsx) every ~12s to refresh the
// three groups without a realtime subscription, per the brief. Also backs
// the initial server-render in app/page.tsx indirectly (that path calls
// getInboxGroups() directly, no HTTP round-trip, for a faster first paint —
// this route exists for the poll only).
export async function GET() {
  try {
    const groups = await getInboxGroups();
    return NextResponse.json(groups, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    // Log server-side only — the response body is generic so we don't leak
    // DB/table internals (error messages, column names, etc.) to the client.
    console.error("[api/inbox] query failed:", e);
    return NextResponse.json({ error: "inbox_query_failed" }, { status: 500 });
  }
}
