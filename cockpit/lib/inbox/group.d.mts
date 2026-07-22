// Types for the framework-free group.mjs so TypeScript callers (data.ts, the
// UI) get full typing while the runtime file stays plain ESM (importable by
// the Node self-test with no build step). Keep in sync with group.mjs.
//
// Structurally compatible with (but intentionally not importing) the richer
// InboxSession/InboxGroups types in ./types.ts, so group.mjs stays a
// standalone, dependency-free unit — any object with these fields works.

export interface InboxSessionLike {
  status: "planned" | "running" | "waiting" | "done" | "reviewed" | "merged" | "rejected";
  updated_at: string;
  latest_decision?: { created_at: string } | null;
}

export interface InboxGroupsLike<T extends InboxSessionLike = InboxSessionLike> {
  needsYou: T[];
  awaitingReview: T[];
  recentlyDecided: T[];
}

/**
 * Buckets `sessions` into the three Inbox groups and sorts each:
 *   - needsYou / awaitingReview: by `updated_at` descending (most recent first).
 *   - recentlyDecided: by `latest_decision.created_at` descending (falls back
 *     to `updated_at` if absent), capped at `recentlyDecidedLimit` (default 20).
 * `planned`/`running` sessions are excluded from every group. Pure — does not
 * mutate the input array.
 */
export declare function groupInboxSessions<T extends InboxSessionLike>(
  sessions: T[],
  opts?: { recentlyDecidedLimit?: number },
): InboxGroupsLike<T>;
