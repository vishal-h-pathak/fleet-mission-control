import { NextResponse, type NextRequest } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isAllowedEmail } from "@/lib/auth/allowlist.mjs";
import { isArmed } from "@/lib/compose/validate.mjs";

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Authed via proxy.ts — but this route is THE execution trigger
// (docs/SCHEMA_V2.md security invariant (a): "confirmed is the sole
// execution trigger, and only the authed cockpit route may set it"), so it
// re-asserts the caller's session and allowlist membership itself rather
// than trusting proxy.ts alone: defense in depth on the one write that makes
// a wave pollable by the `dispatch` Edge Function. This route is the ONLY
// writer of `confirmed` anywhere in the cockpit.
//
// The Confirm screen's "type the wave name to arm" gate is re-checked
// server-side too (against the wave's REAL name, not just echoed back) —
// the client-side button-disable is a UX nicety, not the guard.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ waveId: string }> },
) {
  const { waveId } = await params;
  if (!UUID_RE.test(waveId)) {
    return NextResponse.json({ error: "invalid_wave_id" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const confirmName =
    body && typeof body === "object" && "confirm_name" in body
      ? (body as { confirm_name?: unknown }).confirm_name
      : undefined;

  const authClient = await createClient();
  const {
    data: { user },
  } = await authClient.auth.getUser();
  if (!user || !isAllowedEmail(user.email, process.env.COCKPIT_ALLOWED_EMAILS)) {
    return NextResponse.json({ error: "not_authorized" }, { status: 403 });
  }

  const supabase = getAdminClient();
  const { data: wave, error: waveErr } = await supabase
    .from("fleet_waves")
    .select("id, name, status")
    .eq("id", waveId)
    .maybeSingle();
  if (waveErr) {
    console.error("[api/compose/confirm] wave lookup failed:", waveErr);
    return NextResponse.json({ error: "wave_lookup_failed" }, { status: 500 });
  }
  if (!wave) {
    return NextResponse.json({ error: "unknown_wave" }, { status: 404 });
  }
  if (typeof confirmName !== "string" || !isArmed(confirmName, wave.name)) {
    return NextResponse.json({ error: "not_armed" }, { status: 400 });
  }

  const nowIso = new Date().toISOString();
  const { data: updated, error: updateErr } = await supabase
    .from("fleet_waves")
    .update({
      status: "confirmed",
      confirmed_at: nowIso,
      confirmed_by: user.email,
      updated_at: nowIso,
    })
    .eq("id", waveId)
    .eq("status", "draft")
    .select("id")
    .maybeSingle();
  if (updateErr) {
    console.error("[api/compose/confirm] update failed:", updateErr);
    return NextResponse.json({ error: "confirm_failed" }, { status: 500 });
  }
  if (!updated) {
    // Not a draft any more (already confirmed/abandoned/etc) — race loses
    // cleanly, same guarded-update pattern as lib/inbox/decisions.ts.
    return NextResponse.json({ error: "not_draft" }, { status: 409 });
  }

  return NextResponse.json(
    { ok: true, status: "confirmed" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
