// Fleet Mission Control — commands Edge Function (P2 control plane, machine side).
// Token-authed (per-machine bearer token, sha256 → fleet_machine_secrets), like ingest.
// Lets a machine's agent claim pending commands and report results WITHOUT holding a
// service-role key. verify_jwt OFF (custom token auth enforced in-function).
//
// POST body (Authorization: Bearer <machine-token>):
//   { "action": "claim" }
//       → atomically claims this machine's pending commands; returns { claimed: [rows] }
//   { "action": "running", "id": "<cmd>" }
//       → marks a claimed command running
//   { "action": "result", "id": "<cmd>", "status": "done|error|rejected",
//     "result"?: any, "exit_code"?: number }
//       → finalizes a command (only if it belongs to this machine)
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FINAL = new Set(["done", "error", "rejected"]);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json" },
  });
}
async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const auth = req.headers.get("authorization") ?? "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!token) return json({ error: "missing_token" }, 401);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const tokenHash = await sha256Hex(token);
  const { data: secret, error: secErr } = await admin
    .from("fleet_machine_secrets").select("machine_id").eq("token_hash", tokenHash).maybeSingle();
  if (secErr) return json({ error: "lookup_failed" }, 500);
  if (!secret) return json({ error: "invalid_token" }, 401);
  const machineId = secret.machine_id as string;
  const nowIso = new Date().toISOString();
  const action = body?.action;

  if (action === "claim") {
    // Atomic: only rows still 'pending' for this machine flip to 'claimed'.
    // approved_at is returned so the agent can refuse an unapproved mutating verb (defense-in-depth).
    const { data, error } = await admin
      .from("fleet_commands")
      .update({ status: "claimed", claimed_at: nowIso })
      .eq("machine_id", machineId).eq("status", "pending")
      .select("id, verb, args, created_at, approved_at");
    if (error) return json({ error: "claim_failed" }, 500);
    return json({ claimed: data ?? [] });
  }

  if (action === "running") {
    if (!body?.id) return json({ error: "missing_id" }, 400);
    await admin.from("fleet_commands")
      .update({ status: "running" })
      .eq("id", body.id).eq("machine_id", machineId).eq("status", "claimed");
    return json({ ok: true });
  }

  if (action === "result") {
    if (!body?.id || !FINAL.has(body?.status)) return json({ error: "bad_result" }, 400);
    const { data, error } = await admin.from("fleet_commands")
      .update({
        status: body.status,
        result: body.result ?? null,
        exit_code: body.exit_code ?? null,
        finished_at: nowIso,
      })
      .eq("id", body.id).eq("machine_id", machineId)
      .in("status", ["claimed", "running"])
      .select("id");
    if (error) return json({ error: "result_failed" }, 500);
    return json({ ok: true, updated: (data ?? []).length });
  }

  return json({ error: "unknown_action" }, 400);
});
