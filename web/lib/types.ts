// Shapes mirror the FROZEN schema_version: 1 contract (docs/SCHEMA.md).
// Public surface only — no sensitive columns (rc_url/cmd/etc.) appear here.

export type MachineKind = "cockpit" | "compute" | "phone" | "node";
export type DerivedStatus = "online" | "stale" | "offline";
export type JobStatus =
  | "running"
  | "finished"
  | "failed"
  | "stopped"
  | "unknown";

export interface Gpu {
  index?: number;
  name?: string;
  util_pct?: number;
  mem_used_mb?: number;
  mem_total_mb?: number;
  temp_c?: number;
  power_w?: number;
}

/** One row of the public `fleet_machine_status` view. */
export interface MachineStatus {
  id: string;
  name: string;
  kind: MachineKind | string;
  os: string | null;
  arch: string | null;
  specs: Record<string, unknown> | null;
  agent_version: string | null;
  created_at: string;
  last_seen_at: string | null;
  last_heartbeat_ts: string | null;
  cpu_pct: number | null;
  ram_pct: number | null;
  ram_used_mb: number | null;
  ram_total_mb: number | null;
  load_avg: number[] | null;
  gpu: Gpu[] | null;
  uptime_s: number | null;
  // Server-derived; we also recompute client-side from last_heartbeat_ts for freshness.
  status: DerivedStatus | string;
}

export interface JobProgress {
  gens_done?: number;
  gens_total?: number;
  best_fitness?: number;
  eta_s?: number;
  [k: string]: unknown;
}

/** One row of the public `fleet_jobs` table (safe columns only). */
export interface Job {
  id: string;
  machine_id: string;
  name: string;
  project: string | null;
  kind: string | null;
  status: JobStatus | string;
  started_at: string | null;
  ended_at: string | null;
  updated_at: string | null;
  progress: JobProgress | null;
  exit_code: number | null;
}

/** Sensitive payload returned ONLY by the authed server route. Never on the public client. */
export interface JobLinks {
  job_id: string;
  rc_url: string | null;
  rc_qr: string | null;
}

/** One row of the public `fleet_job_metrics` table (fitness time-series; non-sensitive). */
export interface JobMetric {
  job_id: string;
  ts: string;
  gen: number | null;
  best_fitness: number | null;
  mean_fitness: number | null;
}

/** Log lines returned ONLY by the authed server route. log_tail is SENSITIVE; never public. */
export interface JobLog {
  job_id: string;
  log_tail: string | null;
}
