import { NextResponse, type NextRequest } from "next/server";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth";
import { getServiceClient } from "@/lib/supabase/service";
import { validateCommand, requiresApproval } from "@/lib/commands/allowlist.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Authed, server-only. Dispatches an ALLOWLISTED command to a machine by
// inserting a `pending` row into the private fleet_commands table (deny-all RLS)
// with the service-role key. Gated by middleware; re-verified here as
// defense-in-depth so it is never reachable unauthed. Free-text commands are
// impossible: the verb+args are validated against the SHARED allowlist module
// (the same file the agent uses), and anything off-list is rejected here.

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  const ok = await verifySessionToken(req.cookies.get(COOKIE_NAME)?.value);
  if (!ok) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const { machine_id, verb, args } = (body ?? {}) as {
    machine_id?: unknown;
    verb?: unknown;
    args?: unknown;
  };

  if (typeof machine_id !== "string" || !UUID_RE.test(machine_id)) {
    return NextResponse.json({ error: "invalid_machine_id" }, { status: 400 });
  }

  // Single source of truth: reject any verb/args not on the shared allowlist.
  const v = validateCommand(verb, args);
  if (!v.ok) {
    return NextResponse.json(
      { error: "rejected", message: v.error },
      { status: 400 },
    );
  }

  // Approval gate: powerful verbs (nav/run) land as 'awaiting_approval' and are
  // INVISIBLE to the agent (it only claims status='pending') until a second
  // authed action approves them. Safe verbs go straight to 'pending'.
  const status = requiresApproval(v.verb) ? "awaiting_approval" : "pending";

  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("fleet_commands")
    .insert({
      machine_id,
      verb: v.verb,
      args: v.args,
      status,
      requested_by: "dashboard",
    })
    .select(
      "id, machine_id, verb, args, status, requested_by, approved_by, approved_at, created_at",
    )
    .single();

  if (error) {
    return NextResponse.json(
      { error: "insert_failed", message: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json(
    { command: data },
    { status: 201, headers: { "Cache-Control": "no-store" } },
  );
}
