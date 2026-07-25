// Shared types for the MCv2 Inbox — mirrors docs/SCHEMA_V2.md's
// `fleet_sessions` / `fleet_decisions` shapes. Kept in one place so the data
// layer (lib/inbox/data.ts), the pure grouping logic (lib/inbox/group.mjs),
// and the UI (app/inbox-view.tsx) all agree on the contract.

/** `fleet_sessions.status` enum, per docs/SCHEMA_V2.md. */
export type SessionStatus =
  | "planned"
  | "running"
  | "waiting"
  | "done"
  | "reviewed"
  | "merged"
  | "rejected"
  | "lost";

/** `fleet_decisions.action` enum, per docs/SCHEMA_V2.md. */
export type DecisionAction =
  | "approve_merge"
  | "redispatch_with_feedback"
  | "reject"
  | "dismissed";

export interface LatestDecision {
  action: DecisionAction;
  feedback: string | null;
  created_at: string;
}

/**
 * A `fleet_sessions` row as read by the cockpit, joined to `fleet_waves.name`
 * (nullable — null means the ungrouped bucket) and `fleet_machines.name`, plus
 * (for the recently-decided group) the latest `fleet_decisions` row for that
 * session.
 */
export interface InboxSession {
  id: string;
  name: string;
  status: SessionStatus;
  project: string | null;
  repo: string | null;
  branch: string | null;
  worktree: string | null;
  model: string | null;
  prompt_ref: string | null;
  directive: string | null;
  last_message: string | null;
  rc_url: string | null;
  pr_url: string | null;
  dispatched_at: string | null;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
  /** `fleet_waves.name`, or null for the ungrouped bucket. */
  wave_name: string | null;
  /** `fleet_machines.name`. */
  machine_name: string | null;
  /** Latest `fleet_decisions` row for this session, if any. */
  latest_decision: LatestDecision | null;
}

export interface InboxGroups {
  /** status = 'waiting' — the hook's Notification-driven "needs you" signal.
   * Valid state, but M1 ingest never sets it yet (see SCHEMA_V2.md), so this
   * is expected to render empty until a later milestone wires it up. */
  needsYou: InboxSession[];
  /** status = 'done' — finished, not yet decided. The only group with
   * decision actions (approve / redispatch / reject). */
  awaitingReview: InboxSession[];
  /** status in (reviewed, merged, rejected) — capped, most-recently-decided
   * first. */
  recentlyDecided: InboxSession[];
}
