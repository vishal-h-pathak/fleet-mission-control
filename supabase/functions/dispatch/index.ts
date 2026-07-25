// Fleet Mission Control — dispatch Edge Function (MCv2 M4, machine side).
//
// DIRECT-POLL DISPATCH (design decision of record, operator 2026-07-26): a machine's
// agent polls THIS function for waves the operator has confirmed, claims individual
// sessions, and acks each launch. There is no fleet_commands row acting as the
// trigger. Token-authed per machine (sha256 → fleet_machine_secrets), exactly like
// `ingest`/`commands`; verify_jwt is OFF because agents present a machine token, not
// a Supabase JWT — auth is enforced in-function, below.
//
// WHY A SEPARATE FUNCTION (not another verb on `ingest`): ingest is a write-only
// telemetry sink — its worst case is bad data. This is an execution surface — its
// worst case is unauthorized code running on a box. Different failure and abuse
// profiles deserve different blast radii, different logs, and independent rollback.
//
// Security invariants (mirrored in docs/SCHEMA_V2.md; (a)/(c) are unit-tested in
// test/dispatch-logic.test.mjs):
//   (a) `confirmed` is the sole execution trigger and ONLY the authed cockpit route
//       may set it. This function never writes `confirmed` — it can only move a wave
//       confirmed → launching → dispatched.
//   (b) an agent receives only its OWN machine's work; every read and write is
//       filtered by the authed machine_id, and a cross-machine session id is
//       indistinguishable from a nonexistent one.
//   (c) the free-text `directive` is NEVER transported to an agent. Poll responses
//       are built from an allowlist (POLL_SESSION_FIELDS), not by stripping fields.
//   (d) the agent revalidates everything against its own local allowlist regardless
//       of what the bus says — the bus is untrusted input to the agent.
//
// POST body (Authorization: Bearer <machine-token>):
//   { "action": "poll" }
//       → { work: [ { wave: {...}, session: {...} } ] }  — this machine's launchable,
//         unclaimed, still-`planned` sessions on confirmed/launching waves.
//   { "action": "claim", "session_id": "<uuid>" }
//       → { won: true } | { won: false, reason }  — conditional-update advisory lock.
//   { "action": "ack", "session_id": "<uuid>", "ok": true|false, "error"?: "..." }
//       → { ok: true, wave_status }  — records the launch outcome; completes the wave.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  ackPrecheck,
  ackSessionPatch,
  claimPrecheck,
  DISPATCH_ACTIONS,
  isWaveLaunchable,
  nextWaveStatusOnClaim,
  projectPollSession,
  projectPollWave,
  UUID_RE,
  waveLaunchOutcome,
} from "./dispatch-logic.mjs";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Bounded response: an agent launching >50 sessions in one poll is a bug or an
// attack, not a workflow. The remainder is simply returned by the next poll.
const POLL_LIMIT = 50;

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

// PostgREST returns an embedded to-one relation as an object, but the generated
// types allow an array; normalize once rather than casting at every use.
function one<T>(embed: unknown): T | null {
  if (Array.isArray(embed)) return (embed[0] ?? null) as T | null;
  return (embed ?? null) as T | null;
}

// ── poll ─────────────────────────────────────────────────────────────────────
// Invariant (b): `.eq("machine_id", machineId)` is the FIRST filter and is never
// derived from the request body — only from the token. Invariant (c): the response
// is assembled by projectPollSession's allowlist, so `directive` (and every other
// sensitive column) cannot ride along even if it is selected here. It is not.
async function handlePoll(
  admin: SupabaseClient,
  machineId: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const { data, error } = await admin
    .from("fleet_sessions")
    .select(
      "id, name, project, repo, branch, worktree, model, prompt_ref, " +
        "wave:fleet_waves!inner(id, name, status, project_id)",
    )
    .eq("machine_id", machineId)
    .is("claimed_at", null)
    .eq("status", "planned")
    .in("wave.status", ["confirmed", "launching"])
    .order("created_at", { ascending: true })
    .limit(POLL_LIMIT);
  if (error) return { status: 500, body: { error: "poll_failed" } };

  const rows = data ?? [];

  // Wave context: attach the project registry entry (name/repo/default_branch) so
  // the agent can cross-check the session's own repo against the registry before
  // touching a worktree — invariant (d)'s local revalidation needs both sides.
  const projectIds = [
    ...new Set(rows.map((r: any) => one<any>(r.wave)?.project_id).filter(Boolean)),
  ];
  const projects = new Map<string, any>();
  if (projectIds.length) {
    const { data: pr } = await admin
      .from("fleet_projects")
      .select("id, name, repo, default_branch")
      .in("id", projectIds);
    for (const p of pr ?? []) projects.set(p.id, p);
  }

  const work = rows.map((r: any) => {
    const w = one<any>(r.wave);
    const p = w?.project_id ? projects.get(w.project_id) : null;
    return {
      wave: {
        ...projectPollWave(w),
        project: p ? { name: p.name, repo: p.repo, default_branch: p.default_branch } : null,
      },
      session: projectPollSession(r),
    };
  });

  return { status: 200, body: { work } };
}

// ── claim ────────────────────────────────────────────────────────────────────
// The lock is the conditional UPDATE, not the precheck. The precheck exists only to
// return a USEFUL refusal reason; correctness rests entirely on
//   update ... where id = $1 and machine_id = $auth and claimed_at is null
// which the database serializes, so two agents can never both win one session.
async function handleClaim(
  admin: SupabaseClient,
  machineId: string,
  sessionId: string,
  nowIso: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const lost = (reason: string) => ({ status: 200, body: { won: false, reason } });

  const { data: row, error: readErr } = await admin
    .from("fleet_sessions")
    .select("id, machine_id, status, claimed_at, wave_id, wave:fleet_waves(id, status)")
    .eq("id", sessionId)
    .maybeSingle();
  if (readErr) return { status: 500, body: { error: "claim_lookup_failed" } };

  const waveRow = one<any>((row as any)?.wave);
  const pre = claimPrecheck({
    session: row ? { ...(row as any), wave_status: waveRow?.status ?? null } : null,
    machineId,
  });
  if (!pre.ok) return lost(pre.reason!);

  // The advisory lock. `claimed_at is null` + `status = planned` + the machine
  // filter are all re-asserted here so nothing decided during the read can be
  // trusted — the read is advisory, this UPDATE is authoritative.
  const { data: won, error: claimErr } = await admin
    .from("fleet_sessions")
    .update({ claimed_at: nowIso, claimed_by: machineId, updated_at: nowIso })
    .eq("id", sessionId)
    .eq("machine_id", machineId)
    .is("claimed_at", null)
    .eq("status", "planned")
    .select("id");
  if (claimErr) return { status: 500, body: { error: "claim_failed" } };
  if (!won || won.length !== 1) return lost("already_claimed");

  // Compensating re-check. PostgREST cannot join the wave's status into the session
  // UPDATE above, so a wave abandoned BETWEEN the read and the write would otherwise
  // yield a live claim on dead work. Re-read; if the wave is no longer launchable,
  // RELEASE the claim (scoped to this machine, so we can only ever undo our own) and
  // stand down. Fail-closed: an unexpected read failure also releases.
  const { data: freshWave, error: waveErr } = await admin
    .from("fleet_waves")
    .select("id, status")
    .eq("id", (row as any).wave_id)
    .maybeSingle();
  if (waveErr || !freshWave || !isWaveLaunchable(freshWave.status)) {
    await admin
      .from("fleet_sessions")
      .update({ claimed_at: null, claimed_by: null, updated_at: nowIso })
      .eq("id", sessionId)
      .eq("claimed_by", machineId);
    return lost("wave_not_launchable");
  }

  // Arm the wave. Guarded on `status = 'confirmed'` so concurrent winners are
  // idempotent and no other status can be overwritten. This function can move a
  // wave INTO launching but never into `confirmed` — invariant (a).
  const next = nextWaveStatusOnClaim(freshWave.status);
  if (next !== freshWave.status) {
    await admin
      .from("fleet_waves")
      .update({ status: next, updated_at: nowIso })
      .eq("id", freshWave.id)
      .eq("status", "confirmed");
  }

  return { status: 200, body: { won: true, session_id: sessionId } };
}

// ── ack ──────────────────────────────────────────────────────────────────────
// Records what actually happened to one launch, then completes the wave if nothing
// is outstanding. Ownership is enforced by ackPrecheck (only the machine that WON
// the claim may ack), but neither the wave's status nor the session's status gates
// it — a late ack must still land in the audit trail. See dispatch-logic.mjs.
async function handleAck(
  admin: SupabaseClient,
  machineId: string,
  sessionId: string,
  ok: boolean,
  error: unknown,
  nowIso: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const { data: row, error: readErr } = await admin
    .from("fleet_sessions")
    .select("id, machine_id, claimed_at, claimed_by, launched_at, wave_id")
    .eq("id", sessionId)
    .maybeSingle();
  if (readErr) return { status: 500, body: { error: "ack_lookup_failed" } };

  const pre = ackPrecheck({ session: row as any, machineId });
  if (!pre.ok) return { status: 400, body: { error: `ack_${pre.reason}` } };

  const patch = ackSessionPatch({ session: row as any, ok, error, nowIso });
  const { error: updErr } = await admin
    .from("fleet_sessions")
    .update(patch)
    .eq("id", sessionId)
    .eq("machine_id", machineId);
  if (updErr) return { status: 500, body: { error: "ack_failed" } };

  const waveId = (row as any).wave_id as string | null;
  if (!waveId) return { status: 200, body: { ok: true, wave_status: null } };

  // Wave completion. Read the wave and ALL its sessions (across machines — a wave
  // may span the fleet; this is a service-role read that never leaves the server,
  // and only aggregate counts derived from it are returned).
  const { data: wave } = await admin
    .from("fleet_waves").select("id, status").eq("id", waveId).maybeSingle();
  const { data: siblings } = await admin
    .from("fleet_sessions").select("launched_at, launch_error").eq("wave_id", waveId);

  const outcome = waveLaunchOutcome({
    waveStatus: wave?.status,
    sessions: siblings ?? [],
  });
  if (outcome && wave) {
    // Guarded on the status we just read: if the operator moved the wave in the
    // meantime, our stale conclusion loses cleanly rather than overwriting them.
    await admin
      .from("fleet_waves")
      .update({ status: outcome.status, launch_error: outcome.launch_error, updated_at: nowIso })
      .eq("id", wave.id)
      .eq("status", wave.status);
    return { status: 200, body: { ok: true, wave_status: outcome.status } };
  }
  return { status: 200, body: { ok: true, wave_status: wave?.status ?? null } };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const auth = req.headers.get("authorization") ?? "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!token) return json({ error: "missing_token" }, 401);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  // Validate the request shape BEFORE touching the database.
  const action = body?.action;
  if (typeof action !== "string" || !DISPATCH_ACTIONS.has(action)) {
    return json({ error: "unknown_action" }, 400);
  }
  let sessionId = "";
  if (action !== "poll") {
    if (typeof body?.session_id !== "string" || !UUID_RE.test(body.session_id)) {
      return json({ error: "bad_session_id" }, 400);
    }
    sessionId = body.session_id;
  }
  if (action === "ack" && typeof body?.ok !== "boolean") {
    return json({ error: "bad_ok" }, 400);
  }
  if (action === "ack" && body?.error != null && typeof body.error !== "string") {
    return json({ error: "bad_error" }, 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Resolve the machine from the token hash. `machineId` is the ONLY identity used
  // for scoping below; nothing in the request body can name a machine.
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
  // Liveness: polling proves the agent is up, same as a heartbeat would.
  await admin.from("fleet_machines").update({ last_seen_at: nowIso }).eq("id", machineId);

  let res: { status: number; body: Record<string, unknown> };
  if (action === "poll") {
    res = await handlePoll(admin, machineId);
  } else if (action === "claim") {
    res = await handleClaim(admin, machineId, sessionId, nowIso);
  } else {
    res = await handleAck(admin, machineId, sessionId, body.ok, body.error, nowIso);
  }

  if (res.status !== 200) return json(res.body, res.status);
  return json({ ok: true, machine_id: machineId, at: nowIso, ...res.body });
});
