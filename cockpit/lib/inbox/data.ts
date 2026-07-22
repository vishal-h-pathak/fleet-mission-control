import "server-only";

import { getAdminClient } from "@/lib/supabase/admin";
import { groupInboxSessions } from "./group.mjs";
import type {
  DecisionAction,
  InboxGroups,
  InboxSession,
  SessionStatus,
} from "./types";

// Server-only Inbox data layer. Uses the service-role admin client per repo
// convention (never the anon clients for fleet_* v2 data — see CLAUDE.md).
// All three fleet_* v2 tables here are RLS-private (deny-all), so this is the
// only code path that can read them at all.

const INBOX_STATUSES: SessionStatus[] = [
  "waiting",
  "done",
  "reviewed",
  "merged",
  "rejected",
];

// Safety cap on the raw fetch — well above what any real operator queue
// should hold at once; recentlyDecided is further capped downstream by
// groupInboxSessions' own limit. Prevents an unbounded read if something
// upstream (e.g. a stuck ingest loop) floods fleet_sessions.
const RAW_FETCH_LIMIT = 500;

type RawSessionRow = {
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
  // Supabase-js embeds a to-one FK relationship as an object (or null); some
  // client versions type it as an array depending on inferred cardinality, so
  // accept both shapes defensively.
  fleet_waves: { name: string } | { name: string }[] | null;
  fleet_machines: { name: string } | { name: string }[] | null;
};

type RawDecisionRow = {
  session_id: string;
  action: DecisionAction;
  feedback: string | null;
  created_at: string;
};

function firstOf<T>(value: T | T[] | null): T | null {
  if (value === null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

/**
 * Fetches the Inbox-relevant fleet_sessions rows (status in the Inbox
 * enum subset), joined to wave/machine name, plus each session's latest
 * fleet_decisions row, and buckets them via the pure groupInboxSessions.
 *
 * planned/running sessions are intentionally never fetched — see
 * lib/inbox/group.mjs's header for why they're out of scope for Inbox v1.
 */
export async function getInboxGroups(): Promise<InboxGroups> {
  const supabase = getAdminClient();

  const { data: rows, error: sessionsError } = await supabase
    .from("fleet_sessions")
    .select(
      `id, name, status, project, repo, branch, worktree, model, prompt_ref,
       directive, last_message, rc_url, pr_url, dispatched_at, started_at,
       ended_at, created_at, updated_at,
       fleet_waves ( name ), fleet_machines ( name )`,
    )
    .in("status", INBOX_STATUSES)
    .order("updated_at", { ascending: false })
    .limit(RAW_FETCH_LIMIT)
    .returns<RawSessionRow[]>();

  if (sessionsError) {
    throw new Error(`fleet_sessions query failed: ${sessionsError.message}`);
  }

  const sessionRows = rows ?? [];
  const latestDecisionBySession = await fetchLatestDecisions(
    supabase,
    sessionRows.map((r) => r.id),
  );

  const enriched: InboxSession[] = sessionRows.map((r) => ({
    id: r.id,
    name: r.name,
    status: r.status,
    project: r.project,
    repo: r.repo,
    branch: r.branch,
    worktree: r.worktree,
    model: r.model,
    prompt_ref: r.prompt_ref,
    directive: r.directive,
    last_message: r.last_message,
    rc_url: r.rc_url,
    pr_url: r.pr_url,
    dispatched_at: r.dispatched_at,
    started_at: r.started_at,
    ended_at: r.ended_at,
    created_at: r.created_at,
    updated_at: r.updated_at,
    wave_name: firstOf(r.fleet_waves)?.name ?? null,
    machine_name: firstOf(r.fleet_machines)?.name ?? null,
    latest_decision: latestDecisionBySession.get(r.id) ?? null,
  }));

  return groupInboxSessions(enriched);
}

async function fetchLatestDecisions(
  supabase: ReturnType<typeof getAdminClient>,
  sessionIds: string[],
) {
  const map = new Map<string, InboxSession["latest_decision"]>();
  if (sessionIds.length === 0) return map;

  const { data, error } = await supabase
    .from("fleet_decisions")
    .select("session_id, action, feedback, created_at")
    .in("session_id", sessionIds)
    .order("created_at", { ascending: false })
    .returns<RawDecisionRow[]>();

  if (error) {
    throw new Error(`fleet_decisions query failed: ${error.message}`);
  }

  // Already ordered newest-first, so the first row seen per session_id is
  // its latest decision.
  for (const d of data ?? []) {
    if (!map.has(d.session_id)) {
      map.set(d.session_id, {
        action: d.action,
        feedback: d.feedback,
        created_at: d.created_at,
      });
    }
  }
  return map;
}
