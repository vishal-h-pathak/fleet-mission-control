// cockpit/lib/waves/types.ts
// Shared types for the MCv2 Waves board — mirrors docs/SCHEMA_V2.md's
// `fleet_sessions`/`fleet_waves` shapes, flattened into the grouped read
// model lib/waves/data.ts produces and lib/waves/group.mjs consumes/returns.
// Reuses SessionStatus from lib/inbox/types.ts (same enum, one definition).

import type { SessionStatus } from "@/lib/inbox/types";

export type { SessionStatus };

/**
 * `fleet_waves.status` enum, per docs/SCHEMA_V2.md's "Wave dispatch lifecycle
 * (M4)". `confirmed`/`launching` are new in M4 (Compose is their first
 * writer/reader in the cockpit): draft -> confirmed -> launching ->
 * dispatched -> reviewing -> done | abandoned.
 */
export type WaveStatus =
  | "draft"
  | "confirmed"
  | "launching"
  | "dispatched"
  | "reviewing"
  | "done"
  | "abandoned";

/**
 * A `fleet_sessions` row as read by the Waves board, flattened with its
 * (optional) wave's name/status/dispatched_at/notes and machine name. ALL
 * SEVEN session statuses appear here — unlike the Inbox (which excludes
 * `planned` entirely), this board's whole job is surfacing `planned` rows
 * as first-class, per docs/V2_PLAN.md's M3 milestone.
 */
export interface WaveSession {
  id: string;
  name: string;
  status: SessionStatus;
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
  /** M4 dispatch: non-null once an agent has taken the advisory-lock claim. */
  claimed_at: string | null;
  /** M4 dispatch: preserve-on-null; set on a successful launch ack. */
  launched_at: string | null;
  /** M4 dispatch: set on a failed launch ack; terminal for the launch phase. */
  launch_error: string | null;
  /** null = ungrouped (this session isn't part of any registered wave). */
  wave_id: string | null;
  wave_name: string | null;
  wave_status: WaveStatus | string | null;
  wave_dispatched_at: string | null;
  wave_notes: string | null;
  /** M4 dispatch: when the operator confirmed the parent wave. */
  wave_confirmed_at: string | null;
  /** M4 dispatch: operator email that confirmed the parent wave. */
  wave_confirmed_by: string | null;
  /** M4 dispatch: "<n>/<total> sessions failed to launch", if any did. */
  wave_launch_error: string | null;
  machine_name: string | null;
}

export interface WaveGroup {
  /** null for the synthetic "ungrouped" pseudo-wave. */
  id: string | null;
  /** Wave name, or the literal "ungrouped" for the pseudo-wave. */
  name: string;
  status: WaveStatus | string | null;
  dispatched_at: string | null;
  notes: string | null;
  /** M4 dispatch: null unless status has reached `confirmed`. */
  confirmed_at: string | null;
  /** M4 dispatch: operator email that confirmed this wave. */
  confirmed_by: string | null;
  /** M4 dispatch: "<n>/<total> sessions failed to launch", if any did. */
  launch_error: string | null;
  sessions: WaveSession[];
  /** Count of sessions per status; all seven keys always present (zero-filled). */
  statusCounts: Record<SessionStatus, number>;
}

export interface ProjectGroup {
  /** null if no session in this group carries a project name. */
  project: string | null;
  waves: WaveGroup[];
}

export type MachineDerivedStatus = "online" | "stale" | "offline";

/**
 * One row of the public `fleet_machine_status` view (v1 schema). Read here
 * via the admin/service-role client for a consistent server-only privilege
 * model across the cockpit, even though this view is anon-readable by RLS —
 * see lib/waves/data.ts's header comment.
 */
export interface MachineRailEntry {
  name: string;
  status: MachineDerivedStatus | string;
  last_seen_at: string | null;
}
