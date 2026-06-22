// Fleet Mission Control — ingest Edge Function (P0 + P1 + Phase D F2-b).
// P1: each job may include a `metrics` array of {gen,best_fitness,mean_fitness,ts,extra}
// points, stored idempotently in fleet_job_metrics (public) for fitness sparklines.
// Phase D (F2-b): a job entry may carry `last_message` (final assistant message of a
// finished Code session, from the SessionEnd hook) — SENSITIVE, routed to private
// fleet_job_links only. Finished-row matching is idempotent per (machine_id, name)
// so a hook `finished` (rich) and the reporter's tmux-disappear `finished` backstop
// (bare) converge on ONE row, with preserve-on-null for private fields.
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
//                    "rc_url"?, "rc_qr"?, "cmd"?, "metrics_url"?, "log_tail"?,
//                    "last_message"? } ]   // last_message → private fleet_job_links
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
  const TERMINAL = new Set(["finished", "failed", "stopped"]);
  const jobs = Array.isArray(payload?.jobs) ? payload.jobs : [];
  for (const j of jobs) {
    if (!j?.name) continue;
    const status = j.status ?? "running";
    const isTerminal = TERMINAL.has(status);

    // Find the target row for this (machine,name):
    //   (a) the live `running` row (≤1, enforced by the partial-unique index);
    //   (b) if none AND this record is terminal, the most-recent row regardless
    //       of status — so a hook `finished` transitions the running row, and a
    //       later bare reporter `finished` updates that SAME finished row instead
    //       of inserting a duplicate. (Terminal-only fallback keeps a brand-new
    //       `running` session that reuses a stable name like `nav` from
    //       resurrecting an old finished row.)
    //   (c) else insert a new row.
    const { data: runningRow } = await admin
      .from("fleet_jobs")
      .select("id")
      .eq("machine_id", machineId)
      .eq("name", j.name)
      .eq("status", "running")
      .maybeSingle();

    let target = runningRow ?? null;
    const matchedRunning = !!runningRow;
    if (!target && isTerminal) {
      const { data: recent } = await admin
        .from("fleet_jobs")
        .select("id")
        .eq("machine_id", machineId)
        .eq("name", j.name)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      target = recent ?? null;
    }

    // Build the row patch with preserve-on-null semantics: only include columns
    // the sender meaningfully provides. On UPDATE, omitted columns are left
    // untouched (so a bare reporter `finished` can't blank a richer hook record);
    // on INSERT, omitted columns fall back to table defaults.
    const row: Record<string, unknown> = {
      machine_id: machineId,
      name: j.name,
      status,
      updated_at: nowIso,
    };
    if (j.project != null) row.project = j.project;
    if (j.kind !== undefined) row.kind = j.kind;
    if (j.progress && typeof j.progress === "object" && Object.keys(j.progress).length) {
      row.progress = j.progress;
    }
    if (j.started_at) row.started_at = j.started_at;
    if (j.exit_code !== undefined) row.exit_code = j.exit_code;
    if (j.ended_at !== undefined) {
      row.ended_at = j.ended_at;
    } else if (isTerminal && (matchedRunning || !target)) {
      // Stamp an end time when we close a running row (or insert a fresh terminal
      // row) without one. A reporter `finished` re-hitting an already-finished
      // row falls through here → preserves the hook's original ended_at.
      row.ended_at = nowIso;
    }

    let jobId: string | undefined = target?.id;
    if (jobId) {
      await admin.from("fleet_jobs").update(row).eq("id", jobId);
    } else {
      const { data: ins } = await admin
        .from("fleet_jobs").insert(row).select("id").single();
      jobId = ins?.id;
    }

    // Sensitive bits go to the private links table only, with preserve-on-null:
    // include only fields present & non-null on this record so a bare reporter
    // `finished` (no rc_url/last_message) never nulls a hook-supplied value.
    if (jobId) {
      const link: Record<string, unknown> = { job_id: jobId, updated_at: nowIso };
      for (const k of ["rc_url", "rc_qr", "cmd", "metrics_url", "log_tail", "last_message"]) {
        if (j[k] != null) link[k] = j[k];
      }
      // Only write if there's at least one sensitive field (beyond job_id+updated_at).
      if (Object.keys(link).length > 2) {
        await admin.from("fleet_job_links").upsert(link, { onConflict: "job_id" });
      }
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
