// cockpit/lib/waves/data.ts
import "server-only";

import { getAdminClient } from "@/lib/supabase/admin";
import { groupSessionsByProjectAndWave } from "./group.mjs";
import type { MachineRailEntry, ProjectGroup, WaveSession } from "./types";

// Server-only Waves-board data layer. Uses the service-role admin client —
// same posture as lib/inbox/data.ts. fleet_sessions/fleet_waves are
// RLS-private (deny-all); fleet_machine_status (v1) is technically anon-
// readable, but is read here via the same admin client too, for one
// consistent server-only privilege model across the cockpit rather than
// mixing anon and service-role clients server-side.

// Same cap as lib/inbox/data.ts's RAW_FETCH_LIMIT, for the same reason
// (safety ceiling against an unbounded read, not a real pagination story
// yet) — Waves additionally carries `planned` rows, which Inbox excludes.
const RAW_FETCH_LIMIT = 500;

type RawWaveSessionRow = {
  id: string;
  name: string;
  status: WaveSession["status"];
  project: string | null;
  repo: string | null;
  branch: string | null;
  worktree: string | null;
  model: string | null;
  rc_url: string | null;
  pr_url: string | null;
  dispatched_at: string | null;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
  wave_id: string | null;
  // Supabase-js embeds a to-one FK relationship as an object (or null); some
  // client versions type it as an array depending on inferred cardinality —
  // accept both shapes defensively, same as lib/inbox/data.ts's RawSessionRow.
  fleet_waves:
    | { name: string; status: string; dispatched_at: string | null; notes: string | null }
    | { name: string; status: string; dispatched_at: string | null; notes: string | null }[]
    | null;
  fleet_machines: { name: string } | { name: string }[] | null;
};

type RawMachineStatusRow = {
  name: string;
  status: string;
  last_seen_at: string | null;
};

function firstOf<T>(value: T | T[] | null): T | null {
  if (value === null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

/**
 * Fetches ALL fleet_sessions rows (every status, `planned` included —
 * that's this board's job), joined to wave name/status/dispatched_at/notes
 * and machine name, and groups them project -> wave via the pure
 * groupSessionsByProjectAndWave.
 */
export async function getWavesBoard(): Promise<ProjectGroup[]> {
  const supabase = getAdminClient();

  const { data: rows, error } = await supabase
    .from("fleet_sessions")
    .select(
      `id, name, status, project, repo, branch, worktree, model, rc_url,
       pr_url, dispatched_at, started_at, ended_at, created_at, updated_at,
       wave_id,
       fleet_waves ( name, status, dispatched_at, notes ),
       fleet_machines ( name )`,
    )
    .order("updated_at", { ascending: false })
    .limit(RAW_FETCH_LIMIT)
    .returns<RawWaveSessionRow[]>();

  if (error) {
    throw new Error(`fleet_sessions query failed: ${error.message}`);
  }

  const flat: WaveSession[] = (rows ?? []).map((r) => {
    const wave = firstOf(r.fleet_waves);
    return {
      id: r.id,
      name: r.name,
      status: r.status,
      project: r.project,
      repo: r.repo,
      branch: r.branch,
      worktree: r.worktree,
      model: r.model,
      rc_url: r.rc_url,
      pr_url: r.pr_url,
      dispatched_at: r.dispatched_at,
      started_at: r.started_at,
      ended_at: r.ended_at,
      created_at: r.created_at,
      updated_at: r.updated_at,
      wave_id: r.wave_id,
      wave_name: wave?.name ?? null,
      wave_status: wave?.status ?? null,
      wave_dispatched_at: wave?.dispatched_at ?? null,
      wave_notes: wave?.notes ?? null,
      machine_name: firstOf(r.fleet_machines)?.name ?? null,
    };
  });

  return groupSessionsByProjectAndWave(flat) as ProjectGroup[];
}

/** One-line machine-status rail: every fleet_machine_status row, by name. */
export async function getMachineRail(): Promise<MachineRailEntry[]> {
  const supabase = getAdminClient();

  const { data, error } = await supabase
    .from("fleet_machine_status")
    .select("name, status, last_seen_at")
    .order("name")
    .returns<RawMachineStatusRow[]>();

  if (error) {
    throw new Error(`fleet_machine_status query failed: ${error.message}`);
  }

  return data ?? [];
}
