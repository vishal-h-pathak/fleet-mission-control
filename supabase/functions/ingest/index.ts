// Fleet Mission Control — ingest Edge Function (P0 + P1 + Phase D F2-b + MCv2 v5).
//
// P1: each job may include a `metrics` array of {gen,best_fitness,mean_fitness,ts,extra}
// points, stored idempotently in fleet_job_metrics (public) for fitness sparklines.
//
// Phase D (F2-b): a job entry may carry `last_message` (final assistant message of a
// finished Code session, from the SessionEnd hook) — SENSITIVE, routed to private
// fleet_job_links only. Finished-row matching is idempotent per (machine_id, name)
// so a hook `finished` (rich) and the reporter's tmux-disappear `finished` backstop
// (bare) converge on ONE row, with preserve-on-null for private fields.
//
// MCv2 (v5) — work-centric spine (see docs/SCHEMA_V2.md):
//   • jobs[] may carry `pr_url` (auto-draft-PR hook) and optional `branch`. pr_url is
//     SENSITIVE → dual-written to private fleet_job_links AND fleet_sessions, both
//     preserve-on-null. fleet_sessions is authoritative for the cockpit read model.
//   • SESSION ENRICHMENT: a `claude-session` job enriches fleet_sessions via a
//     job_id-anchored ladder that is race-safe across reporter-first / hook-first /
//     backstop, registered or not. No match ⇒ an ungrouped session is created.
//   • REGISTER block: a launcher POSTs {register:{project,wave,sessions[]}} to record
//     a dispatched wave of `planned` sessions. Same per-machine token auth; records
//     intent only — nothing is executed.
//
// Write-only telemetry sink. Auth = per-machine bearer token (sha256-matched against
// fleet_machine_secrets). verify_jwt is OFF because reporters present a machine token,
// not a Supabase JWT; auth is enforced here, in-function.
//
// POST body:
// {
//   "machine":   { "os"?, "arch"?, "specs"?, "agent_version"? },
//   "heartbeat": { "cpu_pct"?, "ram_pct"?, ..., "raw"? },
//   "jobs":      [ { "name", "project"?, "kind"?, "status"?, "branch"?, "progress"?,
//                    "started_at"?, "ended_at"?, "exit_code"?, "metrics"?,
//                    "rc_url"?, "rc_qr"?, "cmd"?, "metrics_url"?, "log_tail"?,
//                    "last_message"?, "pr_url"? } ],  // last_message/pr_url → private
//   "register":  { "project"|"project_id", "wave":{ "name", ... },
//                  "sessions":[ { "name", "machine"?, "branch"?, ... } ] }
// }
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  NAME_RE,
  nextSessionStatus,
  SESSION_NONTERMINAL,
  WAVE_STATUSES,
} from "./session-logic.mjs";

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

// Enrich fleet_sessions from one claude-session job record. `jobId` is stable across
// a single running→finished lifecycle and fresh for a new one (the v1 fleet_jobs
// upsert guarantees this), which anchors the whole ladder. See docs/SCHEMA_V2.md
// "Enrichment matching" for the race matrix this is proven against.
async function enrichSession(
  admin: SupabaseClient,
  machineId: string,
  j: any,
  jobId: string,
  isTerminal: boolean,
  nowIso: string,
): Promise<void> {
  const cols = "id, status, started_at, ended_at";
  const nonTerminal = [...SESSION_NONTERMINAL];

  // (1) job_id match — the anchor. Covers reporter-then-hook AND the late bare
  //     reporter backstop with zero dupes, whatever the row's current status.
  let { data: sess } = await admin
    .from("fleet_sessions").select(cols).eq("job_id", jobId).maybeSingle();

  // (2) (machine, name) non-terminal — a registered `planned` session's first touch,
  //     or a tmux session whose JOB_NAME equals the registered name.
  if (!sess) {
    const r = await admin
      .from("fleet_sessions").select(cols)
      .eq("machine_id", machineId).eq("name", j.name)
      .in("status", nonTerminal)
      .order("updated_at", { ascending: false }).limit(1).maybeSingle();
    sess = r.data ?? null;
  }

  // (2b) (machine, project, branch) non-terminal — Terminal.app fallback: those
  //      sessions run without tmux, so JOB_NAME becomes claude-<sid8> and never
  //      matches the registered name. Match the planned session by its branch instead.
  if (!sess && j.project != null && j.branch != null) {
    const r = await admin
      .from("fleet_sessions").select(cols)
      .eq("machine_id", machineId).eq("project", j.project).eq("branch", j.branch)
      .in("status", nonTerminal)
      .order("updated_at", { ascending: false }).limit(1).maybeSingle();
    sess = r.data ?? null;
  }

  // Fields carried from the record, preserve-on-null (never blank an existing value).
  const carry: Record<string, unknown> = {};
  if (j.project != null) carry.project = j.project;
  if (j.repo != null) carry.repo = j.repo;
  if (j.branch != null) carry.branch = j.branch;
  if (j.worktree != null) carry.worktree = j.worktree;
  if (j.last_message != null) carry.last_message = j.last_message;
  if (j.rc_url != null) carry.rc_url = j.rc_url;
  if (j.pr_url != null) carry.pr_url = j.pr_url;

  if (sess) {
    const next = nextSessionStatus(sess.status as string, isTerminal);
    const patch: Record<string, unknown> = {
      ...carry,
      status: next,
      job_id: jobId,      // bind the machine-centric join (idempotent once set)
      name: j.name,       // keep the row's name truthful once the real name is known
      updated_at: nowIso,
    };
    if (next === "running" && !sess.started_at) patch.started_at = j.started_at ?? nowIso;
    if (next === "done" && !sess.ended_at) patch.ended_at = j.ended_at ?? nowIso;
    await admin.from("fleet_sessions").update(patch).eq("id", sess.id);
    return;
  }

  // (3) No match ⇒ ungrouped session (wave_id null) so out-of-launcher dispatches
  //     still surface. Retry-on-conflict guards the rare concurrent first-touch race
  //     (partial-unique on active (machine,name)): if a sibling txn just inserted the
  //     row, re-match by job_id / name and update it instead of erroring.
  const insertRow: Record<string, unknown> = {
    ...carry,
    machine_id: machineId,
    job_id: jobId,
    name: j.name,
    status: isTerminal ? "done" : "running",
    started_at: j.started_at ?? nowIso,
    updated_at: nowIso,
  };
  if (isTerminal) insertRow.ended_at = j.ended_at ?? nowIso;

  const ins = await admin.from("fleet_sessions").insert(insertRow);
  if (ins.error) {
    // A sibling txn won the first-touch race. Re-match by job_id, then by active
    // (machine,name) — two plain queries, no filter-DSL interpolation of job names.
    let raced = (await admin
      .from("fleet_sessions").select(cols).eq("job_id", jobId).maybeSingle()).data;
    if (!raced) {
      raced = (await admin
        .from("fleet_sessions").select(cols)
        .eq("machine_id", machineId).eq("name", j.name)
        .in("status", nonTerminal)
        .order("updated_at", { ascending: false }).limit(1).maybeSingle()).data;
    }
    if (raced) {
      const next = nextSessionStatus(raced.status as string, isTerminal);
      const patch: Record<string, unknown> = {
        ...carry, status: next, job_id: jobId, name: j.name, updated_at: nowIso,
      };
      if (next === "done" && !raced.ended_at) patch.ended_at = j.ended_at ?? nowIso;
      await admin.from("fleet_sessions").update(patch).eq("id", raced.id);
    }
  }
}

// Record a dispatched wave of `planned` sessions. Strict validation; records intent
// only — no string here is ever executed anywhere. Idempotent per active
// (machine,name): re-registering a still-planned session reuses its row.
async function handleRegister(
  admin: SupabaseClient,
  machineId: string,
  reg: any,
  nowIso: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const err = (e: string, status = 400) => ({ status, body: { error: e } });

  const sessions = Array.isArray(reg?.sessions) ? reg.sessions : null;
  if (!sessions || !sessions.length) return err("register_no_sessions");
  if (sessions.length > 100) return err("register_too_many_sessions");
  const waveName = reg?.wave?.name;
  if (typeof waveName !== "string" || !waveName.trim() || waveName.length > 200) {
    return err("register_bad_wave_name");
  }

  // Resolve project: explicit project_id (must exist) OR name (upsert by name — this
  // only records a label; nothing runs). Name is charset-validated.
  let projectId: string | undefined;
  if (reg.project_id != null) {
    const { data } = await admin
      .from("fleet_projects").select("id").eq("id", reg.project_id).maybeSingle();
    if (!data) return err("register_unknown_project_id");
    projectId = data.id;
  } else if (typeof reg.project === "string" && NAME_RE.test(reg.project)) {
    await admin.from("fleet_projects").insert({ name: reg.project }).select("id");
    const { data } = await admin
      .from("fleet_projects").select("id").eq("name", reg.project).maybeSingle();
    projectId = data?.id;
  }
  if (!projectId) return err("register_bad_project");

  // Pre-validate & resolve each session's target machine before any write, so a typo
  // fails the whole registration cleanly rather than half-creating a wave.
  const resolved: { name: string; machineId: string; s: any }[] = [];
  for (const s of sessions) {
    if (!s || typeof s.name !== "string" || !NAME_RE.test(s.name)) {
      return err("register_bad_session_name");
    }
    let mId = machineId;
    if (s.machine != null) {
      if (typeof s.machine !== "string") return err("register_bad_machine");
      const { data: mrow } = await admin
        .from("fleet_machines").select("id").eq("name", s.machine).maybeSingle();
      if (!mrow) return { status: 400, body: { error: "register_unknown_machine", machine: s.machine } };
      mId = mrow.id;
    }
    resolved.push({ name: s.name, machineId: mId, s });
  }

  const waveStatus = WAVE_STATUSES.includes(reg?.wave?.status)
    ? reg.wave.status
    : "dispatched";
  const { data: wave, error: waveErr } = await admin
    .from("fleet_waves").insert({
      project_id: projectId,
      name: waveName,
      status: waveStatus,
      registered_by: machineId,
      dispatched_at: reg?.wave?.dispatched_at ?? nowIso,
      notes: typeof reg?.wave?.notes === "string" ? reg.wave.notes : null,
    }).select("id").single();
  if (waveErr || !wave) return err("register_wave_insert_failed", 500);

  const out: { id: string; name: string }[] = [];
  for (const { name, machineId: mId, s } of resolved) {
    const row: Record<string, unknown> = {
      wave_id: wave.id,
      machine_id: mId,
      name,
      status: "planned",
      dispatched_at: nowIso,
      updated_at: nowIso,
    };
    for (const k of ["project", "repo", "branch", "worktree", "prompt_ref", "directive", "model"]) {
      if (s[k] != null) row[k] = s[k];
    }
    // Idempotent: reuse a still-active session with this (machine,name).
    const { data: existing } = await admin
      .from("fleet_sessions").select("id")
      .eq("machine_id", mId).eq("name", name)
      .in("status", [...SESSION_NONTERMINAL])
      .order("updated_at", { ascending: false }).limit(1).maybeSingle();
    if (existing) {
      // Re-registration refreshes wave binding + planning fields but must NOT reset
      // lifecycle status (an already-`running` session stays running).
      const { status: _drop, ...updatePatch } = row;
      await admin.from("fleet_sessions").update(updatePatch).eq("id", existing.id);
      out.push({ id: existing.id, name });
    } else {
      const { data: sIns } = await admin
        .from("fleet_sessions").insert(row).select("id").single();
      if (sIns) out.push({ id: sIns.id, name });
    }
  }

  return {
    status: 200,
    body: { wave_id: wave.id, project_id: projectId, sessions: out },
  };
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

  // 3) Upsert jobs (+ sensitive links) by (machine_id, name); enrich sessions.
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
    // pr_url (MCv2) joins this tier — same sensitivity as rc_url.
    if (jobId) {
      const link: Record<string, unknown> = { job_id: jobId, updated_at: nowIso };
      for (const k of ["rc_url", "rc_qr", "cmd", "metrics_url", "log_tail", "last_message", "pr_url"]) {
        if (j[k] != null) link[k] = j[k];
      }
      // Only write if there's at least one sensitive field (beyond job_id+updated_at).
      if (Object.keys(link).length > 2) {
        await admin.from("fleet_job_links").upsert(link, { onConflict: "job_id" });
      }
    }

    // MCv2 session enrichment — only for Code sessions. fleet_sessions is
    // authoritative for the cockpit read model; last_message/rc_url/pr_url are
    // dual-written here and above (fleet_job_links) from the same record.
    if (jobId && j.kind === "claude-session") {
      await enrichSession(admin, machineId, j, jobId, isTerminal, nowIso);
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

  // 4) MCv2 wave registration (optional). Records a dispatched wave of planned
  //    sessions. Same per-machine token auth; strict validation; no execution.
  let registered: Record<string, unknown> | undefined;
  if (payload?.register && typeof payload.register === "object") {
    const res = await handleRegister(admin, machineId, payload.register, nowIso);
    if (res.status !== 200) return json(res.body, res.status);
    registered = res.body;
  }

  return json({ ok: true, machine_id: machineId, at: nowIso, ...(registered ? { registered } : {}) });
});
