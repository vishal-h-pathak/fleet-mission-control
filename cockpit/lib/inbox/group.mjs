// Plain ESM, zero deps — mirrors the lib/auth/allowlist.mjs pattern (single
// source of truth, importable both by TypeScript via the sibling .d.mts and
// by a standalone Node self-test with no build step).
//
// Pure grouping/sorting logic for the Inbox. Takes fleet_sessions rows
// (already joined to wave/machine name + latest decision by lib/inbox/data.ts)
// and buckets them into the three Inbox groups per docs/SCHEMA_V2.md's
// status enum. Deliberately has zero I/O so it can be unit-tested against
// fixtures with no live Supabase project (see group.test.mjs).
//
// Design choices, per docs/SCHEMA_V2.md ("Status transitions" /
// "Operator decisions" sections):
//   - `planned` sessions are NOT part of the Inbox at all — not yet
//     dispatched work, Waves-board (M3) territory, not a review decision.
//   - `needsYou` = status 'waiting' OR 'running'. Both are "watchable, not
//     actionable" (per SCHEMA_V2.md: "waiting/planned/running sessions have
//     no decision action in M1 — they aren't finished work yet"). Within the
//     group, `waiting` rows sort first (they're the ones actually asking for
//     attention — the hook's future Notification signal; M1 ingest never
//     sets it yet, so expect this empty until a later wave) and `running`
//     rows are appended after them, quietly — still each sorted by recency
//     within their own bucket. Every item keeps its own `status` field so
//     the UI can render `running` rows de-emphasized/without decision
//     affordances while keeping this as one flat, already-ordered list.
//   - `awaitingReview` = status 'done' — the only group with decision actions.
//   - `recentlyDecided` = status in (reviewed, merged, rejected), sorted by
//     the latest fleet_decisions row's created_at (falling back to the
//     session's updated_at if a decided session somehow has none), capped at
//     `recentlyDecidedLimit` (default 10 — "last ~10" per spec) so the group
//     can't grow unbounded.
//   - `needsYou`/`awaitingReview` sort by session `updated_at` descending
//     (most recent activity first) — the common "recent activity feed"
//     convention, applied consistently across both groups (each of
//     `needsYou`'s two internal buckets independently, see above).

/**
 * @param {import('./group.d.mts').InboxSessionLike[]} sessions
 * @param {{ recentlyDecidedLimit?: number }} [opts]
 * @returns {import('./group.d.mts').InboxGroupsLike}
 */
export function groupInboxSessions(sessions, opts = {}) {
  const recentlyDecidedLimit = opts.recentlyDecidedLimit ?? 10;

  const waiting = [];
  const running = [];
  const awaitingReview = [];
  const recentlyDecided = [];

  for (const s of sessions) {
    if (s.status === "waiting") {
      waiting.push(s);
    } else if (s.status === "running") {
      running.push(s);
    } else if (s.status === "done") {
      awaitingReview.push(s);
    } else if (
      s.status === "reviewed" ||
      s.status === "merged" ||
      s.status === "rejected"
    ) {
      recentlyDecided.push(s);
    }
    // planned: intentionally excluded — see module header.
  }

  const byUpdatedAtDesc = (a, b) =>
    new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();

  waiting.sort(byUpdatedAtDesc);
  running.sort(byUpdatedAtDesc);
  awaitingReview.sort(byUpdatedAtDesc);

  recentlyDecided.sort((a, b) => {
    const aKey = a.latest_decision?.created_at ?? a.updated_at;
    const bKey = b.latest_decision?.created_at ?? b.updated_at;
    return new Date(bKey).getTime() - new Date(aKey).getTime();
  });

  return {
    // `waiting` first (actionably "needs you"), `running` quietly after
    // (watchable only) — see module header.
    needsYou: [...waiting, ...running],
    awaitingReview,
    recentlyDecided: recentlyDecided.slice(0, recentlyDecidedLimit),
  };
}
