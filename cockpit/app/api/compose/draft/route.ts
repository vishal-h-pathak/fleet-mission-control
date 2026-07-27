import { NextResponse, type NextRequest } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import {
  buildSessionInsertRow,
  buildWaveInsertRow,
  validateDraftPayload,
} from "@/lib/compose/draft.mjs";

export const dynamic = "force-dynamic";

// Authed via proxy.ts. "Save draft": writes the wave (status='draft') +
// N planned sessions in one call. Mirrors the ingest `register` block's row
// shapes (supabase/functions/ingest/index.ts's handleRegister) but is its own
// write path, not a fork of it through HTTP — Compose is an authed operator
// action, not a machine-token-authed launcher recording a dispatch that
// already happened, so `registered_by`/`dispatched_at`/`worktree` are
// deliberately left null (see lib/compose/draft.mjs's header comment for why).
//
// Nothing is armed here: the wave is created `draft`, never pollable by the
// `dispatch` Edge Function until POST .../confirm flips it (that route is the
// SOLE writer of `confirmed`, per docs/SCHEMA_V2.md security invariant (a)).
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const validated = validateDraftPayload(body);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }
  const { waveName, notes, chunks } = validated;
  const projectId = (body as { project_id: string }).project_id;

  const supabase = getAdminClient();

  // Validate everything before any write — same discipline as ingest's
  // handleRegister: a typo'd machine or unknown project fails the whole
  // request cleanly rather than half-creating a wave.
  const { data: project, error: projectErr } = await supabase
    .from("fleet_projects")
    .select("id, name, repo")
    .eq("id", projectId)
    .eq("active", true)
    .maybeSingle();
  if (projectErr) {
    console.error("[api/compose/draft] project lookup failed:", projectErr);
    return NextResponse.json({ error: "project_lookup_failed" }, { status: 500 });
  }
  if (!project) {
    return NextResponse.json({ error: "unknown_project" }, { status: 400 });
  }

  const machineIds = [...new Set(chunks.map((c) => c.machineId))];
  const { data: machines, error: machinesErr } = await supabase
    .from("fleet_machines")
    .select("id")
    .in("id", machineIds);
  if (machinesErr) {
    console.error("[api/compose/draft] machine lookup failed:", machinesErr);
    return NextResponse.json({ error: "machine_lookup_failed" }, { status: 500 });
  }
  const knownMachineIds = new Set((machines ?? []).map((m) => m.id));
  if (machineIds.some((id) => !knownMachineIds.has(id))) {
    return NextResponse.json({ error: "unknown_machine" }, { status: 400 });
  }

  const { data: wave, error: waveErr } = await supabase
    .from("fleet_waves")
    .insert(buildWaveInsertRow({ projectId: project.id, waveName, notes }))
    .select("id, name, status")
    .single();
  if (waveErr || !wave) {
    console.error("[api/compose/draft] wave insert failed:", waveErr);
    return NextResponse.json({ error: "wave_insert_failed" }, { status: 500 });
  }

  const sessionRows = chunks.map((chunk) =>
    buildSessionInsertRow({
      waveId: wave.id,
      chunk,
      project: project.name,
      repo: project.repo,
    }),
  );
  const { data: sessions, error: sessionsErr } = await supabase
    .from("fleet_sessions")
    .insert(sessionRows)
    .select("id, name");
  if (sessionsErr) {
    console.error("[api/compose/draft] session insert failed:", sessionsErr);
    // The wave now exists with zero sessions. Not auto-cleaned-up: it's a
    // draft, inert, visible on /waves as an empty ungrouped-looking wave the
    // operator can Abandon — safer than a compensating delete racing another
    // read, and consistent with lib/inbox/decisions.ts's own
    // documented-not-atomic compensation stance.
    return NextResponse.json({ error: "session_insert_failed" }, { status: 500 });
  }

  return NextResponse.json(
    { ok: true, wave_id: wave.id, sessions: sessions ?? [] },
    { headers: { "Cache-Control": "no-store" } },
  );
}
