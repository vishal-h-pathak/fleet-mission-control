// cockpit/lib/waves/group.d.mts
// Types for the framework-free group.mjs so TypeScript callers (data.ts, the
// UI) get full typing while the runtime file stays plain ESM (importable by
// the Node self-test with no build step). Keep in sync with group.mjs.
// Structurally compatible with (but intentionally not importing) the richer
// WaveSession/WaveGroup/ProjectGroup types in ./types.ts.

export type SessionStatusLike =
  | "planned"
  | "running"
  | "waiting"
  | "done"
  | "reviewed"
  | "merged"
  | "rejected";

export interface WaveSessionLike {
  id: string;
  status: SessionStatusLike;
  project: string | null;
  wave_id: string | null;
  wave_name?: string | null;
  wave_status?: string | null;
  wave_dispatched_at?: string | null;
  wave_notes?: string | null;
  updated_at: string;
}

export interface WaveGroupLike<T extends WaveSessionLike = WaveSessionLike> {
  id: string | null;
  name: string;
  status: string | null;
  dispatched_at: string | null;
  notes: string | null;
  sessions: T[];
  statusCounts: Record<SessionStatusLike, number>;
}

export interface ProjectGroupLike<T extends WaveSessionLike = WaveSessionLike> {
  project: string | null;
  waves: WaveGroupLike<T>[];
}

/**
 * Buckets `sessions` project -> wave ("ungrouped" as a pseudo-wave per
 * project, sorted last within it), sorts waves newest-first by
 * dispatched_at (falling back to the wave's most-recent session's
 * updated_at), sorts projects by most-recent session activity, sorts each
 * wave's sessions by updated_at descending, and tallies a zero-filled
 * statusCounts per wave across all seven statuses. Pure — does not mutate
 * the input array.
 */
export declare function groupSessionsByProjectAndWave<T extends WaveSessionLike>(
  sessions: T[],
): ProjectGroupLike<T>[];
