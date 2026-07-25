// cockpit/lib/waves/group.mjs
// Plain ESM, zero deps — mirrors lib/inbox/group.mjs's pattern (single
// source of truth, importable both by TypeScript via the sibling .d.mts and
// by a standalone Node self-test with no build step).
//
// Pure grouping/sorting logic for the Waves board. Takes fleet_sessions rows
// (already joined to wave name/status/dispatched_at/notes + machine name by
// lib/waves/data.ts) — ALL SEVEN statuses, unlike the Inbox which excludes
// `planned` — and buckets them project -> wave, "ungrouped" as a pseudo-wave
// per project. Deliberately zero I/O so it can be unit-tested against
// fixtures with no live Supabase project (see group.test.mjs).
//
// Design choices:
//   - Grouped by session.project (the text field on fleet_sessions, always
//     present per docs/SCHEMA_V2.md) — sessions with a null/blank project
//     fall into a single null-keyed bucket.
//   - Within a project, real waves (wave_id present) sort newest-first by
//     wave dispatched_at, falling back to the wave's own most-recent
//     session's updated_at when dispatched_at is unset (e.g. a still-`draft`
//     wave) — "waves newest-first" per docs/V2_PLAN.md. The synthetic
//     "ungrouped" wave (wave_id null) always sorts last within its project —
//     it isn't a real dispatched wave, just a catch-all bucket.
//   - Projects sort by their most-recent session's updated_at, descending —
//     "what is the fleet doing right now" reads top-to-bottom by recency.
//   - Each wave's sessions sort by updated_at descending (same convention as
//     Inbox's needsYou/awaitingReview groups).
//   - Each wave carries a `statusCounts` map over all seven statuses (zero
//     for absent ones) for the wave-header counts the board's spec asks for.

const ALL_STATUSES = [
  "planned",
  "running",
  "waiting",
  "done",
  "reviewed",
  "merged",
  "rejected",
];

const UNGROUPED_KEY = "__ungrouped__";
const UNKNOWN_PROJECT_KEY = "__unknown__";

function emptyStatusCounts() {
  const counts = {};
  for (const s of ALL_STATUSES) counts[s] = 0;
  return counts;
}

function byUpdatedAtDesc(a, b) {
  return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
}

/**
 * @param {import('./group.d.mts').WaveSessionLike[]} sessions
 * @returns {import('./group.d.mts').ProjectGroupLike[]}
 */
export function groupSessionsByProjectAndWave(sessions) {
  const projects = new Map();

  for (const s of sessions) {
    const projectKey =
      s.project && s.project.trim() ? s.project : UNKNOWN_PROJECT_KEY;
    if (!projects.has(projectKey)) {
      projects.set(projectKey, { project: projectKey, waves: new Map() });
    }
    const projectEntry = projects.get(projectKey);

    const waveKey = s.wave_id ?? UNGROUPED_KEY;
    if (!projectEntry.waves.has(waveKey)) {
      projectEntry.waves.set(waveKey, {
        id: s.wave_id ?? null,
        name: s.wave_id ? (s.wave_name ?? "(unnamed wave)") : "ungrouped",
        status: s.wave_id ? (s.wave_status ?? null) : null,
        dispatched_at: s.wave_id ? (s.wave_dispatched_at ?? null) : null,
        notes: s.wave_id ? (s.wave_notes ?? null) : null,
        sessions: [],
        statusCounts: emptyStatusCounts(),
      });
    }
    const waveGroup = projectEntry.waves.get(waveKey);
    waveGroup.sessions.push(s);
    if (Object.prototype.hasOwnProperty.call(waveGroup.statusCounts, s.status)) {
      waveGroup.statusCounts[s.status] += 1;
    }
  }

  const projectGroups = [];
  for (const entry of projects.values()) {
    const waveGroups = [...entry.waves.values()];
    for (const w of waveGroups) {
      w.sessions.sort(byUpdatedAtDesc);
    }
    waveGroups.sort((a, b) => {
      // Ungrouped always sorts last within its project.
      if (a.id === null && b.id === null) return 0;
      if (a.id === null) return 1;
      if (b.id === null) return -1;
      const aKey = a.dispatched_at ?? a.sessions[0]?.updated_at ?? null;
      const bKey = b.dispatched_at ?? b.sessions[0]?.updated_at ?? null;
      if (!aKey && !bKey) return 0;
      if (!aKey) return 1;
      if (!bKey) return -1;
      return new Date(bKey).getTime() - new Date(aKey).getTime();
    });

    const mostRecentUpdate = waveGroups
      .flatMap((w) => w.sessions)
      .reduce((max, s) => {
        const t = new Date(s.updated_at).getTime();
        return t > max ? t : max;
      }, 0);

    projectGroups.push({
      project: entry.project === UNKNOWN_PROJECT_KEY ? null : entry.project,
      waves: waveGroups,
      _sortKey: mostRecentUpdate,
    });
  }

  projectGroups.sort((a, b) => b._sortKey - a._sortKey);
  for (const p of projectGroups) delete p._sortKey;

  return projectGroups;
}
