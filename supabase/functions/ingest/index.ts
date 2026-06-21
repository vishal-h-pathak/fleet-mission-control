// Fleet Mission Control — ingest Edge Function (P0 + P1).
// P1: each job may include a `metrics` array of {gen,best_fitness,mean_fitness,ts,extra}
// points, stored idempotently in fleet_job_metrics (public) for fitness sparklines.
// Write-only telemetry sink. Auth = per-machine bearer token (sha256-matched
// against fleet_machine_secrets). verify_jwt is OFF because reporters present a
// machine token, not a Supabase JWT; auth is enforced here, in-function.
//
// POST body:
// {
//   "machine":   { "os"?, "arch"?, "specs"?, "agent_version"? },
//   "heartbeat": { "cpu_pct"?, "ram_pct"?, "ram_used_mb"?, "ram_total_mb"?,
//                  "load_avg"?:[n,n,n], "gpu"?:[...], "uptime_s"?, "raw"? },
//   "jobs":      [ { "name", "project"?, "kind"?, "status"?, "progress"?,
//                    "started_at"?, "ended_at"?, "exit_code"?,
//                    "rc_url"?, "rc_qr"?, "cmd"?, "metrics_url"?, "log_tail"? } ]
// }
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
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

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Resolve machine from token hash.
  const tokenHash = await sha256Hex(token);
  const { data: secret, error: secErr } = await admin
    .from("fleet_machine_secrets")
    .select("machine_id")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (secErr) return json({ error: "lookup_failed" }, 500);
  if (!secret) return json({ error: "invalid_token" }, 401);
  const machineId = secret.machine_id as string;

  const nowIso = new Date().toISOString();

  // 1) Touch machine: last_seen + optional descriptive fields.
  const m = payload?.machine ?? {};
  const machinePatch: Record<string, unknown> = { last_seen_at: nowIso };
  for (const k of ["os", "arch", "specs", "agent_version"]) {
    if (m[k] !== undefined) machinePatch[k] = m[k];
  }
  await admin.from("fleet_machines").update(machinePatch).eq("id", machineId);

  // 2) Insert heartbeat.
  const hb = payload?.heartbeat;
  if (hb && typeof hb === "object") {
    await admin.from("fleet_heartbeats").insert({
      machine_id: machineId,
      cpu_pct: hb.cpu_pct ?? null,
      ram_pct: hb.ram_pct ?? null,
      ram_used_mb: hb.ram_used_mb ?? null,
      ram_total_mb: hb.ram_total_mb ?? null,
      load_avg: hb.load_avg ?? null,
      gpu: hb.gpu ?? null,
      uptime_s: hb.uptime_s ?? null,
      schema_version: hb.schema_version ?? 1,
      raw: hb.raw ?? null,
    });
  }

  // 3) Upsert jobs (+ sensitive links) by (machine_id, name).
  const jobs = Array.isArray(payload?.jobs) ? payload.jobs : [];
  for (const j of jobs) {
    if (!j?.name) continue;
    const status = j.status ?? "running";

    // Find an existing active row for this (machine,name).
    const { data: existing } = await admin
      .from("fleet_jobs")
      .select("id")
      .eq("machine_id", machineId)
      .eq("name", j.name)
      .eq("status", "running")
      .maybeSingle();

    const row: Record<string, unknown> = {
      machine_id: machineId,
      name: j.name,
      project: j.project ?? null,
      kind: j.kind ?? "other",
      status,
      progress: j.progress ?? {},
      updated_at: nowIso,
    };
    if (j.started_at) row.started_at = j.started_at;
    if (j.ended_at !== undefined) row.ended_at = j.ended_at;
    if (j.exit_code !== undefined) row.exit_code = j.exit_code;

    let jobId: string | undefined = existing?.id;
    if (jobId) {
      await admin.from("fleet_jobs").update(row).eq("id", jobId);
    } else {
      const { data: ins } = await admin
        .from("fleet_jobs").insert(row).select("id").single();
      jobId = ins?.id;
    }

    // Sensitive bits go to the private links table only.
    if (jobId && (j.rc_url || j.rc_qr || j.cmd || j.metrics_url || j.log_tail)) {
      await admin.from("fleet_job_links").upsert({
        job_id: jobId,
        rc_url: j.rc_url ?? null,
        rc_qr: j.rc_qr ?? null,
        cmd: j.cmd ?? null,
        metrics_url: j.metrics_url ?? null,
        log_tail: j.log_tail ?? null,
        updated_at: nowIso,
      });
    }

    // P1: metric time-series (public). Idempotent on (job_id, gen).
    if (jobId && Array.isArray(j.metrics) && j.metrics.length) {
      const withGen = j.metrics
        .filter((p: any) => p && p.gen !== undefined && p.gen !== null)
        .map((p: any) => ({
          job_id: jobId,
          ts: p.ts ?? nowIso,
          gen: p.gen,
          best_fitness: p.best_fitness ?? null,
          mean_fitness: p.mean_fitness ?? null,
          extra: p.extra ?? null,
        }));
      const noGen = j.metrics
        .filter((p: any) => p && (p.gen === undefined || p.gen === null))
        .map((p: any) => ({
          job_id: jobId,
          ts: p.ts ?? nowIso,
          gen: null,
          best_fitness: p.best_fitness ?? null,
          mean_fitness: p.mean_fitness ?? null,
          extra: p.extra ?? null,
        }));
      if (withGen.length) {
        await admin.from("fleet_job_metrics")
          .upsert(withGen, { onConflict: "job_id,gen" });
      }
      if (noGen.length) {
        await admin.from("fleet_job_metrics").insert(noGen);
      }
    }
  }

  return json({ ok: true, machine_id: machineId, at: nowIso });
});
