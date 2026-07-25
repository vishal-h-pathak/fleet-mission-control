# MCv2 Waves Board + Inbox Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `/waves` board (project → wave grouping, planned rows first-class, status chips, PR + `/rc` deep links, one-line machine rail) and ship the three Inbox polish items (Dismiss action, `updated_at` bump on decisions, `middleware.ts` → `proxy.ts`), on branch `feat/mcv2-waves-board`, `cockpit/` only.

**Architecture:** Mirror the Inbox's existing three-layer split exactly: a pure, zero-dep grouping function (`lib/waves/group.mjs`, unit-tested offline like `lib/inbox/group.mjs`), a server-only admin-client data layer (`lib/waves/data.ts`, mirrors `lib/inbox/data.ts`), and a polling client component (`app/waves/waves-view.tsx`, mirrors `app/inbox-view.tsx`). Three view helpers that both `inbox-view.tsx` and `waves-view.tsx` need (`timeAgo`, the `STATUS_STYLE` color map, and the redirect-aware poll-fetch wrapper) are extracted into a shared `lib/ui/session-format.ts` and imported by both, rather than duplicated — they aren't cosmetic: `STATUS_STYLE` gains a status the moment a sibling migration lands (e.g. a future `lost`), and the redirect-aware fetch embodies the session-expiry fix from wave 1's Inbox review, so duplicated copies would need the same fix twice and would drift. The touch to `inbox-view.tsx` this requires is a mechanical import swap only (three local definitions replaced by one import line, three call sites gain a `redirectToLogin` callback argument) — no behavior change, and Task 8's live validation re-verifies the Inbox end to end anyway. Everything else new stays additive to avoid touching shipped Inbox code beyond that swap.

**Tech Stack:** Next.js 16.2.3 (App Router) · React 19.2.0 · Tailwind 4 · `@supabase/supabase-js` · TypeScript. No new dependencies.

## Global Constraints

- Scope is `cockpit/` only. Do NOT edit `docs/SCHEMA_V2.md` — that's the sibling `feat/mcv2-hardening` session's file this wave.
- `fleet_waves`/`fleet_sessions`/`fleet_decisions` are RLS-private (deny-all) — read/write only via `lib/supabase/admin.ts`'s service-role client, from server-only code (`import "server-only"` at the top of every data/decision module, matching `lib/inbox/data.ts`/`lib/inbox/decisions.ts`).
- The `'dismissed'` value is NOT YET in `fleet_decisions.action`'s check constraint live — that's the sibling `hardening` session's proposed migration, applied by the planner at consolidation. Build the UI + route now; if live-testing it 400s/500s on the constraint, that's expected — record it, don't work around it (no client-side shimming, no fake success).
- `rc_url`/`pr_url` are sensitive (leak repo/branch/content) — server-only reads, rendered only to the authed operator, exactly as Inbox already does.
- Every new/changed route relies on `proxy.ts`'s matcher (post-rename) for auth — no per-route auth check duplicated, matching the existing Inbox routes' documented posture.
- Never commit `cockpit/.env.local` (already gitignored via `.env*.local`).

---

### Task 1: Waves types + pure grouping logic (TDD)

**Files:**
- Create: `cockpit/lib/waves/types.ts`
- Create: `cockpit/lib/waves/group.d.mts`
- Create: `cockpit/lib/waves/group.test.mjs`
- Create: `cockpit/lib/waves/group.mjs`

**Interfaces:**
- Produces: `groupSessionsByProjectAndWave(sessions: WaveSessionLike[]): ProjectGroupLike[]` — pure, zero I/O. `WaveSession`, `WaveGroup`, `ProjectGroup`, `WaveStatus`, `MachineRailEntry` types (consumed by Task 2's `data.ts` and Task 4's UI).

- [ ] **Step 1: Write `types.ts`**

```ts
// cockpit/lib/waves/types.ts
// Shared types for the MCv2 Waves board — mirrors docs/SCHEMA_V2.md's
// `fleet_sessions`/`fleet_waves` shapes, flattened into the grouped read
// model lib/waves/data.ts produces and lib/waves/group.mjs consumes/returns.
// Reuses SessionStatus from lib/inbox/types.ts (same enum, one definition).

import type { SessionStatus } from "@/lib/inbox/types";

export type { SessionStatus };

/** `fleet_waves.status` enum, per docs/SCHEMA_V2.md. */
export type WaveStatus =
  | "draft"
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
  /** null = ungrouped (this session isn't part of any registered wave). */
  wave_id: string | null;
  wave_name: string | null;
  wave_status: WaveStatus | string | null;
  wave_dispatched_at: string | null;
  wave_notes: string | null;
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
```

- [ ] **Step 2: Write `group.d.mts`** (types for the framework-free `group.mjs`, mirrors `lib/inbox/group.d.mts`)

```ts
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
```

- [ ] **Step 3: Write the failing test `group.test.mjs`**

```js
#!/usr/bin/env node
// Waves-board grouping self-test (offline, zero deps, fixture data — no DB).
//   node lib/waves/group.test.mjs   (exit 0 = all passed)
//
// Covers groupSessionsByProjectAndWave(): the pure function that buckets
// fleet_sessions rows (already joined to wave name/status/dispatched_at/
// notes + machine name) project -> wave, "ungrouped" as a pseudo-wave per
// project. Written before group.mjs existed, per TDD.

import assert from "node:assert/strict";
import { groupSessionsByProjectAndWave } from "./group.mjs";

let passed = 0;
function ok(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    console.error(`FAIL  ${name}\n      ${e.stack ?? e.message}`);
    process.exitCode = 1;
  }
}

function session(overrides) {
  return {
    id: "id-default",
    name: "feat/default",
    status: "done",
    project: "portfolio",
    wave_id: "wave-1",
    wave_name: "mcv2-wave1",
    wave_status: "dispatched",
    wave_dispatched_at: "2026-07-22T10:00:00.000Z",
    wave_notes: null,
    created_at: "2026-07-22T10:00:00.000Z",
    updated_at: "2026-07-22T10:00:00.000Z",
    ...overrides,
  };
}

console.log("Waves grouping self-test\n");

ok("empty input -> empty result", () => {
  assert.deepEqual(groupSessionsByProjectAndWave([]), []);
});

ok("groups by project then wave", () => {
  const a = session({ id: "a", project: "portfolio", wave_id: "w1", wave_name: "wave-one" });
  const b = session({ id: "b", project: "portfolio", wave_id: "w1", wave_name: "wave-one" });
  const c = session({ id: "c", project: "jobify", wave_id: "w2", wave_name: "wave-two" });
  const result = groupSessionsByProjectAndWave([a, b, c]);
  assert.equal(result.length, 2);
  const portfolio = result.find((p) => p.project === "portfolio");
  const jobify = result.find((p) => p.project === "jobify");
  assert.equal(portfolio.waves.length, 1);
  assert.deepEqual(portfolio.waves[0].sessions.map((s) => s.id).sort(), ["a", "b"]);
  assert.equal(jobify.waves.length, 1);
  assert.equal(jobify.waves[0].name, "wave-two");
});

ok("null wave_id becomes the 'ungrouped' pseudo-wave, sorted last", () => {
  const grouped = session({ id: "g", wave_id: "w1", wave_name: "real-wave", wave_dispatched_at: "2026-07-20T00:00:00.000Z" });
  const ungrouped = session({ id: "u", wave_id: null, wave_name: null, wave_status: null, wave_dispatched_at: null, updated_at: "2026-07-25T00:00:00.000Z" });
  const result = groupSessionsByProjectAndWave([ungrouped, grouped]);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].waves.map((w) => w.name), ["real-wave", "ungrouped"]);
  assert.equal(result[0].waves[1].id, null);
  assert.equal(result[0].waves[1].status, null);
});

ok("real waves sort newest-first by dispatched_at", () => {
  const older = session({ id: "o", wave_id: "w-old", wave_name: "old-wave", wave_dispatched_at: "2026-07-01T00:00:00.000Z" });
  const newer = session({ id: "n", wave_id: "w-new", wave_name: "new-wave", wave_dispatched_at: "2026-07-20T00:00:00.000Z" });
  const result = groupSessionsByProjectAndWave([older, newer]);
  assert.deepEqual(result[0].waves.map((w) => w.name), ["new-wave", "old-wave"]);
});

ok("wave missing dispatched_at falls back to its most-recent session's updated_at", () => {
  const noDispatch = session({
    id: "nd", wave_id: "w-draft", wave_name: "draft-wave", wave_dispatched_at: null,
    updated_at: "2026-07-24T00:00:00.000Z",
  });
  const dispatched = session({ id: "d", wave_id: "w-real", wave_name: "real-wave", wave_dispatched_at: "2026-07-01T00:00:00.000Z" });
  const result = groupSessionsByProjectAndWave([dispatched, noDispatch]);
  // draft-wave's fallback (2026-07-24) is newer than real-wave's explicit dispatched_at (2026-07-01).
  assert.deepEqual(result[0].waves.map((w) => w.name), ["draft-wave", "real-wave"]);
});

ok("sessions within a wave sort by updated_at descending", () => {
  const older = session({ id: "o", updated_at: "2026-07-22T09:00:00.000Z" });
  const newer = session({ id: "n", updated_at: "2026-07-22T12:00:00.000Z" });
  const result = groupSessionsByProjectAndWave([older, newer]);
  assert.deepEqual(result[0].waves[0].sessions.map((s) => s.id), ["n", "o"]);
});

ok("projects sort by most-recent session activity descending", () => {
  const stale = session({ id: "s", project: "old-project", wave_id: "w1", updated_at: "2026-07-01T00:00:00.000Z" });
  const fresh = session({ id: "f", project: "fresh-project", wave_id: "w2", updated_at: "2026-07-25T00:00:00.000Z" });
  const result = groupSessionsByProjectAndWave([stale, fresh]);
  assert.deepEqual(result.map((p) => p.project), ["fresh-project", "old-project"]);
});

ok("null/blank project falls into a single null-keyed bucket", () => {
  const noProject = session({ id: "np", project: null, wave_id: "w1" });
  const blankProject = session({ id: "bp", project: "  ", wave_id: "w1" });
  const result = groupSessionsByProjectAndWave([noProject, blankProject]);
  assert.equal(result.length, 1);
  assert.equal(result[0].project, null);
  assert.deepEqual(result[0].waves[0].sessions.map((s) => s.id).sort(), ["bp", "np"]);
});

ok("statusCounts tallies all seven statuses, zero-filled", () => {
  const planned = session({ id: "p", status: "planned", wave_id: "w1" });
  const running = session({ id: "r", status: "running", wave_id: "w1" });
  const result = groupSessionsByProjectAndWave([planned, running]);
  assert.deepEqual(result[0].waves[0].statusCounts, {
    planned: 1, running: 1, waiting: 0, done: 0, reviewed: 0, merged: 0, rejected: 0,
  });
});

ok("does not mutate the input array", () => {
  const input = [session({ id: "x" }), session({ id: "y", wave_id: "w2" })];
  const frozenOrder = input.map((s) => s.id);
  groupSessionsByProjectAndWave(input);
  assert.deepEqual(input.map((s) => s.id), frozenOrder);
});

console.log(`\n${passed} passed`);
if (process.exitCode) {
  console.error("\nSELF-TEST FAILED");
} else {
  console.log("\nAll good.");
}
```

- [ ] **Step 4: Run test to verify it fails (module doesn't exist yet)**

Run: `cd cockpit && node lib/waves/group.test.mjs`
Expected: `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../lib/waves/group.mjs'`

- [ ] **Step 5: Write `group.mjs`**

```js
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
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd cockpit && node lib/waves/group.test.mjs`
Expected: `9 passed` / `All good.`

- [ ] **Step 7: Wire into `npm test`**

Modify `cockpit/package.json`'s `"test"` script:

```json
"test": "node lib/auth/allowlist.test.mjs && node lib/inbox/group.test.mjs && node lib/inbox/decisions-core.test.mjs && node lib/waves/group.test.mjs"
```

- [ ] **Step 8: Commit**

```bash
git add cockpit/lib/waves/types.ts cockpit/lib/waves/group.d.mts cockpit/lib/waves/group.mjs cockpit/lib/waves/group.test.mjs cockpit/package.json
git commit -m "cockpit: Waves board types + pure project/wave grouping logic"
```

---

### Task 2: Waves data layer

**Files:**
- Create: `cockpit/lib/waves/data.ts`

**Interfaces:**
- Consumes: `getAdminClient()` from `@/lib/supabase/admin` (existing); `groupSessionsByProjectAndWave` from `./group.mjs` (Task 1).
- Produces: `getWavesBoard(): Promise<ProjectGroup[]>`, `getMachineRail(): Promise<MachineRailEntry[]>` (consumed by Task 3's API route and Task 4's `app/waves/page.tsx`).

- [ ] **Step 1: Write `data.ts`**

```ts
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
```

- [ ] **Step 2: Typecheck**

Run: `cd cockpit && npx tsc --noEmit`
Expected: no errors referencing `lib/waves/data.ts`.

- [ ] **Step 3: Commit**

```bash
git add cockpit/lib/waves/data.ts
git commit -m "cockpit: Waves board server-only data layer (fleet_sessions + machine rail)"
```

---

### Task 3: Waves API route

**Files:**
- Create: `cockpit/app/api/waves/route.ts`

**Interfaces:**
- Consumes: `getWavesBoard`, `getMachineRail` from `@/lib/waves/data` (Task 2).
- Produces: `GET /api/waves` → `{ projects: ProjectGroup[]; machines: MachineRailEntry[] }`, polled by Task 4's `waves-view.tsx`.

- [ ] **Step 1: Write the route**

```ts
// cockpit/app/api/waves/route.ts
import { NextResponse } from "next/server";
import { getMachineRail, getWavesBoard } from "@/lib/waves/data";

export const dynamic = "force-dynamic";

// Authed via proxy.ts (not in its exclusion list). Polled by the client-side
// Waves view (app/waves/waves-view.tsx) every ~12s — same cadence and
// pattern as the Inbox's /api/inbox (see app/api/inbox/route.ts).
export async function GET() {
  try {
    const [projects, machines] = await Promise.all([
      getWavesBoard(),
      getMachineRail(),
    ]);
    return NextResponse.json(
      { projects, machines },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    // Log server-side only — generic response body, no DB internals leaked.
    console.error("[api/waves] query failed:", e);
    return NextResponse.json({ error: "waves_query_failed" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `cd cockpit && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add cockpit/app/api/waves/route.ts
git commit -m "cockpit: /api/waves polling route"
```

---

### Task 4: Shared view helpers + Waves UI + shared nav

**Files:**
- Create: `cockpit/lib/ui/session-format.ts`
- Modify: `cockpit/app/inbox-view.tsx`
- Create: `cockpit/app/nav.tsx`
- Create: `cockpit/app/waves/page.tsx`
- Create: `cockpit/app/waves/waves-view.tsx`
- Modify: `cockpit/app/page.tsx`

**Interfaces:**
- Consumes: `ProjectGroup`, `WaveSession`, `MachineRailEntry` from `@/lib/waves/types` (Task 1); `getWavesBoard`, `getMachineRail` from `@/lib/waves/data` (Task 2); `SessionStatus` from `@/lib/inbox/types` (existing).
- Produces: `timeAgo(iso: string | null): string`, `STATUS_STYLE: Record<SessionStatus, string>`, `fetchOrRedirectToLogin(url: string, redirectToLogin: () => void, init?: RequestInit): Promise<Response | null>` from `@/lib/ui/session-format` — consumed by both `app/inbox-view.tsx` (modified in this task) and `app/waves/waves-view.tsx` (new in this task).

- [ ] **Step 1: Extract the shared view-helper module**

`app/inbox-view.tsx` currently defines `timeAgo`, `STATUS_STYLE`, and a closure-based `fetchOrRedirectToLogin` inline. The Waves board needs the same three. Rather than duplicate them (they aren't cosmetic — `STATUS_STYLE` gains a status the moment a sibling migration lands, e.g. a future `lost`, and `fetchOrRedirectToLogin` embodies the session-expiry fix from wave 1's Inbox review), extract them once:

```ts
// cockpit/lib/ui/session-format.ts
// Shared client-side view helpers for both the Inbox (app/inbox-view.tsx)
// and the Waves board (app/waves/waves-view.tsx) — session status coloring,
// relative-time formatting, and the redirect-aware poll/decision fetch
// wrapper. Extracted rather than duplicated per-view because these aren't
// cosmetic: STATUS_STYLE gains a status (e.g. a future `lost`) the moment a
// sibling migration lands, and fetchOrRedirectToLogin embodies the
// session-expiry fix from wave 1's Inbox review — duplicated, both would
// need the same fix twice and would drift.

import type { SessionStatus } from "@/lib/inbox/types";

export function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "—";
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

// All seven statuses get an entry — the Inbox never renders `planned` (it
// excludes those sessions), but the Waves board does, so this map has to
// cover it anyway.
export const STATUS_STYLE: Record<SessionStatus, string> = {
  planned: "bg-zinc-500/15 text-zinc-300 border-zinc-400/30",
  running: "bg-sky-500/15 text-sky-300 border-sky-400/30",
  waiting: "bg-amber-500/15 text-amber-300 border-amber-400/30",
  done: "bg-indigo-500/15 text-indigo-300 border-indigo-400/30",
  reviewed: "bg-emerald-500/15 text-emerald-300 border-emerald-400/30",
  merged: "bg-emerald-500/15 text-emerald-300 border-emerald-400/30",
  rejected: "bg-rose-500/15 text-rose-300 border-rose-400/30",
};

// proxy.ts 302-redirects to /login whenever the Supabase session is
// missing/expired. Plain fetch() follows redirects by default, so an
// expired-session response would otherwise come back as a 200 with the
// /login page's HTML body — res.ok true, but .json() throws on it (or
// parses garbage). `redirect: "manual"` stops the browser from following
// the redirect and instead hands back an opaque response (`type:
// "opaqueredirect"`, `status: 0`); treat that as "signed out" and invoke
// `redirectToLogin` instead of freezing the poll or surfacing a JSON-parse
// error. Takes the redirect callback as a parameter (rather than importing
// `next/navigation` itself) so callers supply their own `router.push`.
export async function fetchOrRedirectToLogin(
  url: string,
  redirectToLogin: () => void,
  init?: RequestInit,
): Promise<Response | null> {
  const res = await fetch(url, { ...init, redirect: "manual" });
  if (res.type === "opaqueredirect" || res.status === 0) {
    redirectToLogin();
    return null;
  }
  return res;
}
```

- [ ] **Step 2: Point `app/inbox-view.tsx` at the shared module**

This is a mechanical import swap — no behavior change. In `app/inbox-view.tsx`:

1. Delete the local `timeAgo` function definition (the one starting `function timeAgo(iso: string | null): string {`).
2. Delete the local `STATUS_STYLE` const definition (the one starting `const STATUS_STYLE: Record<InboxSession["status"], string> = {`).
3. Delete the local `fetchOrRedirectToLogin` closure defined inside `InboxView` (the one starting `async function fetchOrRedirectToLogin(` with its preceding explanatory comment block — that rationale now lives in `lib/ui/session-format.ts`).
4. Add the import:

```tsx
import { fetchOrRedirectToLogin, STATUS_STYLE, timeAgo } from "@/lib/ui/session-format";
```

5. Update the three call sites that used the local closure to instead call the imported function with an explicit `redirectToLogin` callback — each becomes `fetchOrRedirectToLogin(url, () => router.push("/login"), init)`:
   - In the poll `useEffect`: `fetchOrRedirectToLogin("/api/inbox", () => router.push("/login"), { cache: "no-store" })`.
   - In `handleDecide`'s decision POST: `` fetchOrRedirectToLogin(`/api/sessions/${id}/${path}`, () => router.push("/login"), { method: "POST", headers: { "Content-Type": "application/json" }, body: action === "redispatch_with_feedback" ? JSON.stringify({ feedback }) : undefined }) ``.
   - In `handleDecide`'s post-decision refresh: `fetchOrRedirectToLogin("/api/inbox", () => router.push("/login"), { cache: "no-store" })`.

Everything else in the file (types, `primaryTimestamp`, `SessionRow`, `Section`, the polling interval, all JSX) is unchanged.

- [ ] **Step 3: Typecheck**

Run: `cd cockpit && npx tsc --noEmit`
Expected: no errors — confirms the Inbox still compiles against the extracted module before the Waves board (which depends on the same module) is built.

- [ ] **Step 4: Commit**

```bash
git add cockpit/lib/ui/session-format.ts cockpit/app/inbox-view.tsx
git commit -m "cockpit: extract shared timeAgo/STATUS_STYLE/fetchOrRedirectToLogin for Inbox + Waves"
```

- [ ] **Step 5: Write the shared nav**

```tsx
// cockpit/app/nav.tsx
import Link from "next/link";

// Shared top nav between the Inbox (/) and the Waves board (/waves) — both
// pages render this inside the same authed layout shell (see app/page.tsx,
// app/waves/page.tsx).
export function CockpitNav({ active }: { active: "inbox" | "waves" }) {
  const linkClass = (isActive: boolean) =>
    `rounded-lg px-3 py-1.5 text-sm font-medium ${
      isActive
        ? "bg-white/10 text-zinc-50"
        : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
    }`;

  return (
    <nav className="mt-4 flex gap-2 border-b border-white/10 pb-4">
      <Link href="/" className={linkClass(active === "inbox")}>
        Inbox
      </Link>
      <Link href="/waves" className={linkClass(active === "waves")}>
        Waves
      </Link>
    </nav>
  );
}
```

- [ ] **Step 6: Write `waves-view.tsx`**

```tsx
// cockpit/app/waves/waves-view.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchOrRedirectToLogin, STATUS_STYLE, timeAgo } from "@/lib/ui/session-format";
import type {
  MachineRailEntry,
  ProjectGroup,
  WaveSession,
} from "@/lib/waves/types";

const POLL_INTERVAL_MS = 12_000;

const WAVE_STATUS_STYLE: Record<string, string> = {
  draft: "bg-zinc-500/15 text-zinc-300 border-zinc-400/30",
  dispatched: "bg-sky-500/15 text-sky-300 border-sky-400/30",
  reviewing: "bg-amber-500/15 text-amber-300 border-amber-400/30",
  done: "bg-emerald-500/15 text-emerald-300 border-emerald-400/30",
  abandoned: "bg-rose-500/15 text-rose-300 border-rose-400/30",
};

const MACHINE_DOT_STYLE: Record<string, string> = {
  online: "bg-emerald-400",
  stale: "bg-amber-400",
  offline: "bg-zinc-500",
};

const STATUS_ORDER: WaveSession["status"][] = [
  "planned",
  "running",
  "waiting",
  "done",
  "reviewed",
  "merged",
  "rejected",
];

// Picks the most relevant relative timestamp per session status — mirrors
// app/inbox-view.tsx's primaryTimestamp, extended with a `planned` case
// (dispatched_at, falling back to created_at) since Waves is the one board
// that renders planned rows.
function primaryTimestamp(session: WaveSession): string | null {
  switch (session.status) {
    case "planned":
      return session.dispatched_at ?? session.created_at;
    case "running":
      return session.started_at ?? session.updated_at;
    case "done":
      return session.ended_at ?? session.updated_at;
    default:
      return session.updated_at;
  }
}

function MachineRail({ machines }: { machines: MachineRailEntry[] }) {
  if (machines.length === 0) {
    return <p className="mt-4 text-xs text-zinc-500">No machines reporting.</p>;
  }
  return (
    <p className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-400">
      {machines.map((m) => (
        <span key={m.name} className="inline-flex items-center gap-1.5">
          <span
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${
              MACHINE_DOT_STYLE[m.status] ?? "bg-zinc-600"
            }`}
          />
          <span className="text-zinc-300">{m.name}</span>
          <span>
            {m.status} · {timeAgo(m.last_seen_at)}
          </span>
        </span>
      ))}
    </p>
  );
}

function SessionRow({ session }: { session: WaveSession }) {
  return (
    <li className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-mono text-sm text-zinc-100">
              {session.name}
            </span>
            <span
              className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[session.status]}`}
            >
              {session.status}
            </span>
          </div>
          <p className="mt-1 truncate text-xs text-zinc-400">
            {session.branch ?? "—"} · {session.machine_name ?? "—"} ·{" "}
            {session.model ?? "—"} · {timeAgo(primaryTimestamp(session))}
          </p>
        </div>
        <div className="flex shrink-0 gap-3 text-xs">
          {session.rc_url && (
            <a
              href={session.rc_url}
              target="_blank"
              rel="noreferrer"
              className="text-indigo-300 underline underline-offset-2"
            >
              /rc
            </a>
          )}
          {session.pr_url && (
            <a
              href={session.pr_url}
              target="_blank"
              rel="noreferrer"
              className="text-indigo-300 underline underline-offset-2"
            >
              PR
            </a>
          )}
        </div>
      </div>
    </li>
  );
}

function WaveSection({ wave }: { wave: ProjectGroup["waves"][number] }) {
  const counts = STATUS_ORDER.map(
    (s) => [s, wave.statusCounts[s]] as const,
  ).filter(([, n]) => n > 0);

  return (
    <div className="rounded-2xl border border-white/5 bg-white/[0.01] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm text-zinc-100">
          {wave.id === null ? "Ungrouped" : wave.name}
        </span>
        {wave.status && (
          <span
            className={`rounded-full border px-2 py-0.5 text-xs font-medium ${
              WAVE_STATUS_STYLE[wave.status] ??
              "bg-zinc-500/15 text-zinc-300 border-zinc-400/30"
            }`}
          >
            {wave.status}
          </span>
        )}
        {wave.dispatched_at && (
          <span className="text-xs text-zinc-500">
            dispatched {timeAgo(wave.dispatched_at)}
          </span>
        )}
      </div>
      {wave.notes && <p className="mt-1 text-xs text-zinc-500">{wave.notes}</p>}
      {counts.length > 0 && (
        <p className="mt-1 text-xs text-zinc-500">
          {counts.map(([s, n]) => `${n} ${s}`).join(" · ")}
        </p>
      )}
      <ul className="mt-2 space-y-2">
        {wave.sessions.map((s) => (
          <SessionRow key={s.id} session={s} />
        ))}
      </ul>
    </div>
  );
}

function ProjectSection({ group }: { group: ProjectGroup }) {
  return (
    <section>
      <h2 className="text-sm font-semibold text-zinc-200">
        {group.project ?? "(unknown project)"}
      </h2>
      <div className="mt-2 space-y-3">
        {group.waves.map((w) => (
          <WaveSection key={w.id ?? "ungrouped"} wave={w} />
        ))}
      </div>
    </section>
  );
}

export function WavesView({
  initialProjects,
  initialMachines,
}: {
  initialProjects: ProjectGroup[];
  initialMachines: MachineRailEntry[];
}) {
  const [projects, setProjects] = useState(initialProjects);
  const [machines, setMachines] = useState(initialMachines);
  const inFlight = useRef(false);
  const router = useRouter();

  useEffect(() => {
    const interval = setInterval(async () => {
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        const res = await fetchOrRedirectToLogin(
          "/api/waves",
          () => router.push("/login"),
          { cache: "no-store" },
        );
        if (res?.ok) {
          const next = (await res.json()) as {
            projects: ProjectGroup[];
            machines: MachineRailEntry[];
          };
          setProjects(next.projects);
          setMachines(next.machines);
        }
      } catch {
        // ignore; retried on next tick
      } finally {
        inFlight.current = false;
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [router]);

  return (
    <div className="mt-2">
      <MachineRail machines={machines} />
      <div className="mt-6 space-y-8">
        {projects.length === 0 ? (
          <p className="text-sm text-zinc-500">No sessions yet.</p>
        ) : (
          projects.map((g) => (
            <ProjectSection key={g.project ?? "(unknown project)"} group={g} />
          ))
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Write `app/waves/page.tsx`**

```tsx
// cockpit/app/waves/page.tsx
import { getMachineRail, getWavesBoard } from "@/lib/waves/data";
import { WavesView } from "./waves-view";
import { CockpitNav } from "../nav";
import { SignOutButton } from "../sign-out-button";

export const dynamic = "force-dynamic";

// Authed landing for the Waves board. Reaching this point means proxy.ts
// already confirmed a valid session + allowlisted email. Fetches the initial
// board + machine rail server-side (admin client, no HTTP round-trip) so the
// first paint has real data; WavesView takes over polling (/api/waves) from
// there — same split as app/page.tsx / InboxView.
export default async function WavesPage() {
  const [initialProjects, initialMachines] = await Promise.all([
    getWavesBoard(),
    getMachineRail(),
  ]);

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col px-6 py-8">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-zinc-50">Waves</h1>
        <SignOutButton />
      </header>
      <CockpitNav active="waves" />
      <WavesView
        initialProjects={initialProjects}
        initialMachines={initialMachines}
      />
    </main>
  );
}
```

- [ ] **Step 8: Wire the nav into `app/page.tsx`**

Modify `cockpit/app/page.tsx`:

```tsx
import { createClient } from "@/lib/supabase/server";
import { getInboxGroups } from "@/lib/inbox/data";
import { InboxView } from "./inbox-view";
import { SignOutButton } from "./sign-out-button";
import { CockpitNav } from "./nav";

// Authed content, reads the per-request session cookie — never static.
export const dynamic = "force-dynamic";

// Authed landing page = the Inbox. Reaching this point means proxy.ts
// already confirmed a valid session AND an allowlisted email — no further
// auth check needed here. Fetches the initial three groups server-side
// (admin client, no HTTP round-trip) so the first paint has real data;
// InboxView takes over polling (/api/inbox) from there.
export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const initialGroups = await getInboxGroups();

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col px-6 py-8">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-zinc-50">MCv2 Cockpit</h1>
        <SignOutButton />
      </header>
      <p className="mt-2 text-sm text-zinc-400">
        Signed in as <span className="text-zinc-200">{user?.email}</span>
      </p>
      <CockpitNav active="inbox" />

      <InboxView initialGroups={initialGroups} />
    </main>
  );
}
```

(Only the import line, the `middleware.ts` → `proxy.ts` comment wording, the new `import { CockpitNav } from "./nav";`, and the `<CockpitNav active="inbox" />` line are new — everything else in the file is unchanged.)

- [ ] **Step 9: Typecheck + build**

Run: `cd cockpit && npx tsc --noEmit && npm run build`
Expected: no errors; `/waves` appears in the build's route list.

- [ ] **Step 10: Commit**

```bash
git add cockpit/app/nav.tsx cockpit/app/waves/page.tsx cockpit/app/waves/waves-view.tsx cockpit/app/page.tsx
git commit -m "cockpit: /waves board UI + shared Inbox/Waves nav"
```

---

### Task 5: Inbox — Dismiss action (TDD for the pure core, then wire the route + UI)

**Files:**
- Modify: `cockpit/lib/inbox/types.ts`
- Modify: `cockpit/lib/inbox/decisions-core.mjs`
- Modify: `cockpit/lib/inbox/decisions-core.d.mts`
- Modify: `cockpit/lib/inbox/decisions-core.test.mjs`
- Create: `cockpit/app/api/sessions/[id]/dismiss/route.ts`
- Modify: `cockpit/app/inbox-view.tsx`

**Interfaces:**
- `DecisionAction` gains `"dismissed"`, mapped to `nextStatusForDecision("dismissed") === "reviewed"`.
- Produces: `POST /api/sessions/[id]/dismiss` (no body), same response shape as `/approve` and `/reject`.

- [ ] **Step 1: Add `"dismissed"` to the `DecisionAction` union**

Modify `cockpit/lib/inbox/types.ts` (lines 17-20):

```ts
/** `fleet_decisions.action` enum, per docs/SCHEMA_V2.md. */
export type DecisionAction =
  | "approve_merge"
  | "redispatch_with_feedback"
  | "reject"
  | "dismissed";
```

- [ ] **Step 2: Write the failing test in `decisions-core.test.mjs`**

Add, after the existing `"reject -> rejected"` test (around line 40):

```js
ok("dismissed -> reviewed", () => {
  assert.equal(nextStatusForDecision("dismissed"), "reviewed");
});
```

Add, after the existing `"validateDecisionPayload: reject needs no feedback"` test (around line 61):

```js
ok("validateDecisionPayload: dismissed needs no feedback", () => {
  const result = validateDecisionPayload("dismissed", {});
  assert.deepEqual(result, { ok: true, feedback: null });
});

ok("validateDecisionPayload: dismissed ignores an incidental feedback field", () => {
  const result = validateDecisionPayload("dismissed", { feedback: "noise" });
  assert.deepEqual(result, { ok: true, feedback: null });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd cockpit && node lib/inbox/decisions-core.test.mjs`
Expected: `FAIL  dismissed -> reviewed` (throws "unknown decision action: dismissed").

- [ ] **Step 4: Implement — add `dismissed` to `decisions-core.mjs`'s map**

Modify `cockpit/lib/inbox/decisions-core.mjs` (lines 1-17), update the header comment and the map:

```js
// Plain ESM, zero deps — mirrors lib/auth/allowlist.mjs / lib/inbox/group.mjs.
//
// Pure decision logic shared by the four decision API routes
// (app/api/sessions/[id]/{approve,redispatch,reject,dismiss}/route.ts). Zero
// I/O so it can be unit-tested against fixtures with no live Supabase
// project (see decisions-core.test.mjs). Encodes the status-transition table
// from docs/SCHEMA_V2.md's "operator-driven" section:
//   approve_merge             -> reviewed
//   redispatch_with_feedback  -> reviewed
//   reject                    -> rejected
//   dismissed                 -> reviewed  (noise-dismiss on an ungrouped
//                                 session — same transition as approve,
//                                 distinct label; the sibling `hardening`
//                                 session is adding 'dismissed' to the
//                                 fleet_decisions.action check constraint —
//                                 see the contract note in
//                                 ops/prompts/PROMPT_mcv2_waves_board.md)

/** @type {Record<import('./decisions-core.d.mts').DecisionAction, import('./decisions-core.d.mts').OperatorStatus>} */
const STATUS_FOR_ACTION = {
  approve_merge: "reviewed",
  redispatch_with_feedback: "reviewed",
  reject: "rejected",
  dismissed: "reviewed",
};
```

`validateDecisionPayload` needs no code change — `dismissed` isn't `"redispatch_with_feedback"`, so it already falls through to the existing `return { ok: true, feedback: null };` at the bottom of the function, same as `approve_merge`/`reject`.

- [ ] **Step 5: Update the type declaration**

Modify `cockpit/lib/inbox/decisions-core.d.mts` (lines 6-9):

```ts
export type DecisionAction =
  | "approve_merge"
  | "redispatch_with_feedback"
  | "reject"
  | "dismissed";
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd cockpit && node lib/inbox/decisions-core.test.mjs`
Expected: all tests pass (previous 9 + 3 new = 12 passed).

- [ ] **Step 7: Add the dismiss route**

```ts
// cockpit/app/api/sessions/[id]/dismiss/route.ts
import { NextResponse, type NextRequest } from "next/server";
import { applyDecision } from "@/lib/inbox/decisions";
import { isValidSessionId } from "@/lib/inbox/session-id";

export const dynamic = "force-dynamic";

// Authed via proxy.ts (see approve/route.ts's comment — same posture).
//
// Dismiss -> insert fleet_decisions(action='dismissed') -> flip session
// status to 'reviewed', same transition as approve. Distinct action so the
// audit trail (and the Inbox's "Recently decided" label) shows this was
// noise-dismissed, not approved. See lib/inbox/decisions.ts for the
// guard/ordering. CONTRACT NOTE: 'dismissed' is not yet in the live
// fleet_decisions.action check constraint — the sibling `hardening` session's
// migration adds it, applied by the planner at consolidation. Until then this
// route's insert is expected to fail (see lib/inbox/decisions.ts's
// insertError branch) — that's a known, expected-pending-migration state,
// not a bug in this route.

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!isValidSessionId(id)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  const result = await applyDecision(id, "dismissed", {});
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.httpStatus },
    );
  }

  return NextResponse.json(
    { ok: true, status: result.status },
    { headers: { "Cache-Control": "no-store" } },
  );
}
```

- [ ] **Step 8: Add the Dismiss UI to `app/inbox-view.tsx`**

Modify the `DECISION_LABEL` map (lines 75-79):

```tsx
const DECISION_LABEL: Record<DecisionAction, string> = {
  approve_merge: "Approved",
  redispatch_with_feedback: "Redispatch requested",
  reject: "Rejected",
  dismissed: "Dismissed",
};
```

Add two new label/style maps right after it (used by the generic confirm block below):

```tsx
const CONFIRM_LABEL: Record<"approve_merge" | "reject" | "dismissed", string> = {
  approve_merge: "approve",
  reject: "reject",
  dismissed: "dismiss",
};

const CONFIRM_BUTTON_STYLE: Record<"approve_merge" | "reject" | "dismissed", string> = {
  approve_merge: "bg-emerald-500 text-zinc-950",
  reject: "bg-rose-500 text-white",
  dismissed: "bg-zinc-600 text-zinc-50",
};
```

In `SessionRow`, add a `canDismiss` flag next to the existing `canDecide` (around line 121-122):

```tsx
  const isRunning = session.status === "running";
  const canDecide = showActions && !isRunning;
  // Dismiss is only offered on ungrouped ("no-op") sessions — ones dispatched
  // outside any registered wave, per the spec's "Dismiss on ungrouped/no-op
  // sessions" wording.
  const canDismiss = canDecide && session.wave_name === null;
```

Replace the generic confirm block (currently lines ~275-298, the `: confirming ? (...)` branch) with:

```tsx
          ) : confirming ? (
            <div className="flex gap-2">
              <button
                type="button"
                disabled={pending !== null}
                onClick={() => commit(confirming)}
                className={`min-h-9 rounded-lg px-3 text-sm font-medium disabled:opacity-50 ${CONFIRM_BUTTON_STYLE[confirming]}`}
              >
                {pending ? "Working…" : `Confirm ${CONFIRM_LABEL[confirming]}`}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(null)}
                className="min-h-9 rounded-lg border border-white/10 px-3 text-sm text-zinc-300"
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setConfirming("approve_merge")}
                className="min-h-9 rounded-lg bg-emerald-500/90 px-3 text-sm font-medium text-zinc-950"
              >
                Approve
              </button>
              <button
                type="button"
                onClick={() => setConfirming("redispatch_with_feedback")}
                className="min-h-9 rounded-lg bg-amber-500/90 px-3 text-sm font-medium text-zinc-950"
              >
                Redispatch with feedback
              </button>
              <button
                type="button"
                onClick={() => setConfirming("reject")}
                className="min-h-9 rounded-lg bg-rose-500/90 px-3 text-sm font-medium text-white"
              >
                Reject
              </button>
              {canDismiss && (
                <button
                  type="button"
                  onClick={() => setConfirming("dismissed")}
                  className="min-h-9 rounded-lg border border-white/10 bg-white/[0.03] px-3 text-sm font-medium text-zinc-300"
                >
                  Dismiss
                </button>
              )}
            </div>
          )}
```

Note: `confirming`'s type here narrows to `"approve_merge" | "reject" | "dismissed"` inside this branch (the preceding `confirming === "redispatch_with_feedback" ? ... :` check already excludes that literal, and the `confirming ?` truthy check excludes `null`) — `CONFIRM_LABEL[confirming]` / `CONFIRM_BUTTON_STYLE[confirming]` typecheck without a cast.

In `InboxView`'s `handleDecide`, extend the `path` mapping (lines 431-436):

```tsx
    const path =
      action === "approve_merge"
        ? "approve"
        : action === "reject"
          ? "reject"
          : action === "dismissed"
            ? "dismiss"
            : "redispatch";
```

- [ ] **Step 9: Typecheck**

Run: `cd cockpit && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add cockpit/lib/inbox/types.ts cockpit/lib/inbox/decisions-core.mjs cockpit/lib/inbox/decisions-core.d.mts cockpit/lib/inbox/decisions-core.test.mjs cockpit/app/api/sessions/\[id\]/dismiss/route.ts cockpit/app/inbox-view.tsx
git commit -m "cockpit Inbox: Dismiss action on ungrouped sessions (dismissed -> reviewed)"
```

---

### Task 6: Decision routes bump `updated_at`

**Files:**
- Modify: `cockpit/lib/inbox/decisions.ts:35-97`

**Interfaces:** No signature changes — `applyDecision` still returns `ApplyDecisionResult`.

- [ ] **Step 1: Add `updated_at` to the guarded status update**

Modify `cockpit/lib/inbox/decisions.ts`, inside `applyDecision` (currently lines 45-54):

```ts
  const supabase = getAdminClient();
  const nextStatus = nextStatusForDecision(action);
  // wave-1 bug fix: the schema-approval write left updated_at stale — every
  // operator-driven status flip must bump it, same as any real mutation
  // would (docs/V2_PLAN.md's M3 wave calls this out explicitly).
  const now = new Date().toISOString();

  const { data: updated, error: updateError } = await supabase
    .from("fleet_sessions")
    .update({ status: nextStatus, updated_at: now })
    .eq("id", sessionId)
    .eq("status", "done")
    .select("id")
    .maybeSingle();
```

- [ ] **Step 2: Bump `updated_at` on the compensating rollback too**

Modify the compensating update inside the `insertError` branch (currently lines 90-94):

```ts
    await supabase
      .from("fleet_sessions")
      .update({ status: "done", updated_at: new Date().toISOString() })
      .eq("id", sessionId)
      .eq("status", nextStatus);
```

(Same table, same bug class as Step 1 — the rollback is a real session mutation too, and leaving it stale would defeat the fix's purpose.)

- [ ] **Step 3: Typecheck**

Run: `cd cockpit && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add cockpit/lib/inbox/decisions.ts
git commit -m "cockpit Inbox: bump fleet_sessions.updated_at on every decision write"
```

---

### Task 7: `middleware.ts` → `proxy.ts` migration

**Files:**
- Rename: `cockpit/middleware.ts` → `cockpit/proxy.ts`
- Modify: `cockpit/lib/supabase/admin.ts`, `cockpit/lib/supabase/client.ts`, `cockpit/lib/supabase/server.ts`, `cockpit/lib/supabase/env.ts`, `cockpit/lib/auth/allowlist.test.mjs`, `cockpit/app/auth/callback/route.ts`, `cockpit/app/api/inbox/route.ts`, `cockpit/app/api/sessions/[id]/approve/route.ts`, `cockpit/app/api/sessions/[id]/reject/route.ts`, `cockpit/app/api/sessions/[id]/redispatch/route.ts`, `cockpit/README.md`
- (`cockpit/app/page.tsx`'s `middleware.ts` comment was already fixed in Task 4; `cockpit/app/inbox-view.tsx`'s was deleted outright in Task 4 along with the closure it documented — no separate edit to either here.)

**Interfaces:** No behavioral change — Next.js 16's `proxy.ts` file convention is a rename of `middleware.ts` plus a rename of the exported `middleware` function to `proxy`; `export const config = { matcher: [...] }` is unchanged (confirmed via the official `v16.2.9` upgrade docs: the codemod only touches the filename and the function name).

- [ ] **Step 1: Rename the file and its exported function**

```bash
cd cockpit && git mv middleware.ts proxy.ts
```

Edit `proxy.ts`: rename `export async function middleware(request: NextRequest) {` (line 18) to `export async function proxy(request: NextRequest) {`. Leave everything else — including `export const config = { matcher: [...] }` — unchanged.

- [ ] **Step 2: Update doc comments referencing `middleware.ts`**

Each of these is a comment-only change (no logic touched); grep confirmed this exact set as of this plan's writing — re-grep before editing in case Tasks 1-6 added new hits:

```bash
cd cockpit && grep -rn "middleware" --include="*.ts" --include="*.tsx" --include="*.md" --include="*.mjs" . | grep -v node_modules
```

Update each hit's wording from "middleware.ts" to "proxy.ts" (verb "runs"/"gates"/"redirects" stays as-is — only the filename changes), specifically:
- `README.md` (6 hits: lines ~20, 26, 42, 50, 69, 79) — including renaming the `## Auth model` bullet `- \`middleware.ts\` — runs on every route...` to `- \`proxy.ts\` — runs on every route...`.
- `app/auth/callback/route.ts:10` — `"proxy.ts runs again on that redirect and does the allowlist check."`
- `lib/supabase/admin.ts:8-10` — also fix the pre-existing inaccurate path in the same sentence (`lib/supabase/middleware.ts` doesn't exist; the real file is at the project root): `"or from proxy.ts (the edge proxy runtime should never hold this key — it only needs the anon-key session client in lib/supabase/server.ts). Import it ONLY from Server Components..."`.
- `lib/supabase/client.ts:9` — `"proxy.ts and server components can read the same session..."`.
- `lib/supabase/env.ts:2` — `"(browser, server anon, edge proxy)."`.
- `lib/supabase/server.ts:28` — `"Safe to ignore because proxy.ts refreshes the session cookie..."`.
- `lib/auth/allowlist.test.mjs:4` — `"used by proxy.ts to gate authed-but-unauthorized sessions."`.

(`app/page.tsx` line 9's comment was already updated to say `proxy.ts` in Task 4 Step 8's surrounding context — verify it reads `proxy.ts`, not `middleware.ts`, while here. `app/inbox-view.tsx`'s old `middleware.ts` comment was deleted outright in Task 4 Step 2 along with the closure it documented — its replacement rationale now lives in `lib/ui/session-format.ts`'s header comment, written correctly from the start, so there is nothing left to fix in `app/inbox-view.tsx` here.)

The five decision routes' `"Authed via middleware.ts"` comments (`approve`, `reject`, `redispatch`, and `dismiss` — Task 5's implementer correctly wrote `dismiss/route.ts`'s comment against the file's actual name at the time, `middleware.ts`, matching its sibling routes rather than the brief's forward-looking `proxy.ts` wording) each become `"Authed via proxy.ts"`, and `app/api/inbox/route.ts:6`'s `"Authed via middleware.ts"` likewise. The re-grep in this step's command already covers `dismiss/route.ts` — no separate handling needed.

- [ ] **Step 3: Build + typecheck**

Run: `cd cockpit && npx tsc --noEmit && npm run build`
Expected: no errors; Next.js recognizes `proxy.ts` as the proxy/middleware file (no "middleware.ts not found" warning, no duplicate-convention error).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "cockpit: migrate middleware.ts -> proxy.ts (Next 16 convention)"
```

---

### Task 8: Live validation against the bus

No new files — this task wires local credentials and runs the acceptance checks from `ops/prompts/PROMPT_mcv2_waves_board.md`.

- [ ] **Step 1: Wire local env**

```bash
cd /Users/jarvis/dev/jarvis/fleet-wt/mcv2-waves-board
grep -E '^(NEXT_PUBLIC_SUPABASE_URL|NEXT_PUBLIC_SUPABASE_ANON_KEY|SUPABASE_SERVICE_ROLE_KEY)=' .fleet-secrets.env > cockpit/.env.local
echo 'COCKPIT_ALLOWED_EMAILS=vshlpthk1@gmail.com' >> cockpit/.env.local
```

Confirm `cockpit/.env.local` is still gitignored (`git check-ignore -v cockpit/.env.local`) before doing anything else with it.

- [ ] **Step 2: Install, self-test, typecheck, build**

```bash
cd cockpit
npm install    # only if node_modules is absent
npm test       # allowlist + inbox group + decisions-core + waves group self-tests
npx tsc --noEmit
npm run build
```

Expected: all four self-test files pass; typecheck clean; build succeeds and lists `/`, `/waves`, and the API routes.

- [ ] **Step 3: Grep the build output for the service-role key**

```bash
cd cockpit
SERVICE_KEY=$(grep '^SUPABASE_SERVICE_ROLE_KEY=' .env.local | cut -d= -f2-)
grep -rl "$SERVICE_KEY" .next/static 2>/dev/null && echo "LEAK FOUND" || echo "clean: not in client bundle"
```

Expected: `clean: not in client bundle` (matches the existing Inbox acceptance criterion #4).

- [ ] **Step 4: Start the app and verify auth still gates `/waves`**

```bash
cd cockpit && npm start &   # or npm run dev
sleep 2
curl -sI http://localhost:3000/ | head -1        # expect a 307/302 to /login
curl -sI http://localhost:3000/waves | head -1   # expect a 307/302 to /login
```

Expected: both unauthenticated requests redirect to `/login` — proves `proxy.ts`'s matcher still covers `/waves` post-rename.

- [ ] **Step 5: Verify the Waves board's data correctness against the live bus**

Since a real magic-link sign-in requires clicking an emailed link (not scriptable), verify the data layer directly with a throwaway script using the same admin client + grouping function, rather than only trusting the UI:

```bash
cd cockpit
node --experimental-strip-types -e "
const { getWavesBoard, getMachineRail } = await import('./lib/waves/data.ts');
console.log(JSON.stringify(await getWavesBoard(), null, 2));
console.log(JSON.stringify(await getMachineRail(), null, 2));
" 2>&1 | tee /tmp/waves-live-check.json
```

(If `--experimental-strip-types` isn't available in the installed Node version, write an equivalent throwaway `.mjs` script that inlines the same two queries + `groupSessionsByProjectAndWave` call, run it with plain `node`, then delete it — do not leave a stray script committed.)

Confirm in the output: the `mcv2-wave1` wave appears under its project with its three (`reviewed`) sessions, and an `ungrouped` pseudo-wave appears for any sessions with a null `wave_id`.

For the actual rendered UI (mobile + desktop screenshots, per acceptance criterion #2), sign in for real — either the operator completes the magic-link flow once and hands off the resulting session cookie for a Playwright screenshot pass, or the operator screenshots it themselves. If neither is available in this session, report that plainly as not completed (with the reason), rather than fabricating or skipping silently — this repo's own convention (`ONBOARDING.md`: "radical honesty / no overclaiming").

- [ ] **Step 6: Verify a decision write bumps `updated_at`**

Using the live bus (either through the real UI once signed in, or a throwaway admin-client script mirroring `applyDecision`), pick or create a `done`-status session, record its `updated_at`, call the approve (or reject) route, and confirm `updated_at` changed and is now `>=` the pre-call timestamp.

- [ ] **Step 7: Exercise the Dismiss path as far as the constraint allows**

Find a live `done`-status session with `wave_name === null` (ungrouped). If none exists, insert one throwaway row via the admin client for this sole purpose (status `done`, `wave_id` null) — same sanctioned pattern as the sibling `hardening` session's `mcv2-selftest` throwaway wave (`ops/prompts/PROMPT_mcv2_hardening.md` §3) — and report its id for cleanup. `POST /api/sessions/<id>/dismiss`:
- If it succeeds: unexpected but not wrong — means the sibling's migration already landed; record that.
- If it 400s/500s on the `fleet_decisions.action` check constraint: expected, record the exact status/error code returned, per the contract note — do not modify code to work around it.

- [ ] **Step 8: Stop the dev/prod server**

```bash
kill %1 2>/dev/null  # or the PID from Step 4
```

- [ ] **Step 9: No commit** — this task only validates; nothing here is source to commit (leave `cockpit/.env.local` in place locally, gitignored, for any follow-up validation).

---

### Task 9: Commit → push → STOP

Per `ops/prompts/PROMPT_fleet_conventions.md`'s STOP-gate block — Tasks 1-7 already committed incrementally; this task pushes and reports.

- [ ] **Step 1: Confirm everything is committed**

```bash
cd /Users/jarvis/dev/jarvis/fleet-wt/mcv2-waves-board
git status
```

Expected: clean (only `cockpit/.env.local`, gitignored, may show as untracked-but-ignored — nothing else).

- [ ] **Step 2: Push**

```bash
git push -u origin feat/mcv2-waves-board
```

If push fails, run `cg artifact <path>` as the fallback and note it in the report.

- [ ] **Step 3: STOP and report**

Report, per the STOP-gate block: **branch** (`feat/mcv2-waves-board`), **commit SHA** (`git rev-parse --short HEAD`), **push result** (pushed / failed-why / artifact-fallback), plus the four acceptance-criteria results from Task 8 (build/typecheck clean + auth gate; live wave-1 rendering — data-layer-verified vs. UI-screenshot status; `updated_at` bump proof; Dismiss path outcome — expected-pending-migration or already-landed; service-role key absence). Don't merge.

---

## Self-Review Notes

- **Spec coverage:** project→wave grouping ✅(Task 1/2/4), waves newest-first + ungrouped pseudo-wave ✅(Task 1), all-seven-status chips with `planned` first-class ✅(Task 4), wave header (name/status/dispatched_at/notes/counts) ✅(Task 4), one-line machine rail via service-role route ✅(Task 2/3/4), nav between `/` and `/waves` ✅(Task 4), Dismiss action + contract note ✅(Task 5), `updated_at` bump ✅(Task 6), `middleware.ts`→`proxy.ts` ✅(Task 7), live validation + STOP-gate ✅(Task 8/9).
- **Placeholder scan:** no TBD/"add error handling"/"similar to Task N" left in any step — every step has literal code or an exact command.
- **Type consistency:** `WaveSession`/`WaveGroup`/`ProjectGroup`/`MachineRailEntry` (Task 1) are the exact shapes Task 2's `data.ts`, Task 3's route, and Task 4's UI import and consume — checked field-by-field. `DecisionAction`'s `"dismissed"` (Task 5) flows through `decisions-core.mjs`, the new route, and `inbox-view.tsx`'s label/style maps consistently.
