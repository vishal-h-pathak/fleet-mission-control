"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  DecisionAction,
  InboxGroups,
  InboxSession,
} from "@/lib/inbox/types";
import { fetchOrRedirectToLogin, STATUS_STYLE, timeAgo } from "@/lib/ui/session-format";

const POLL_INTERVAL_MS = 12_000;

// Machine-readable decision-error codes from the API (lib/inbox/decisions.ts,
// app/api/sessions/[id]/*/route.ts) mapped to operator-friendly copy. Codes
// not listed here fall back to the raw code (still better than nothing).
const DECISION_ERROR_MESSAGE: Partial<Record<string, string>> = {
  not_awaiting_review: "This session was already decided elsewhere.",
  invalid_json: "That request could not be sent — please try again.",
};

function decisionErrorMessage(code: string | undefined, status: number): string {
  if (code && DECISION_ERROR_MESSAGE[code]) return DECISION_ERROR_MESSAGE[code];
  if (code) return code;
  return `Request failed (${status})`;
}

// Picks the most relevant timestamp per row for the always-visible
// relative-time (spec: every row shows project · wave · branch · machine ·
// model · relative time, collapsed). `updated_at` is the general default,
// but a couple of statuses have a more specific, more useful moment:
//   - running: `started_at` — "how long has this been running", not "when
//     did we last hear a heartbeat" (which is what updated_at means here).
//   - done: `ended_at` — "how long has this been sitting awaiting review".
//   - reviewed/merged/rejected: the latest_decision's `created_at` — "how
//     long ago was this decided" (matches recentlyDecided's own sort key).
function primaryTimestamp(session: InboxSession): string | null {
  switch (session.status) {
    case "running":
      return session.started_at ?? session.updated_at;
    case "done":
      return session.ended_at ?? session.updated_at;
    case "reviewed":
    case "merged":
    case "rejected":
      return session.latest_decision?.created_at ?? session.updated_at;
    default:
      return session.updated_at;
  }
}

const DECISION_LABEL: Record<DecisionAction, string> = {
  approve_merge: "Approved",
  redispatch_with_feedback: "Redispatch requested",
  reject: "Rejected",
};

function StatusPill({ session }: { session: InboxSession }) {
  // For a decided session, the decision action (approve/redispatch/reject)
  // is the meaningful label — 'reviewed' alone is ambiguous between "approve
  // merge" and "redispatch with feedback". Fall back to the raw status.
  const label = session.latest_decision
    ? DECISION_LABEL[session.latest_decision.action]
    : session.status;
  return (
    <span
      className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[session.status]}`}
    >
      {label}
    </span>
  );
}

type PendingAction = DecisionAction | null;

function SessionRow({
  session,
  showActions,
  onDecide,
}: {
  session: InboxSession;
  showActions: boolean;
  onDecide: (
    id: string,
    action: DecisionAction,
    feedback?: string,
  ) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [confirming, setConfirming] = useState<PendingAction>(null);
  const [pending, setPending] = useState<PendingAction>(null);
  const [feedback, setFeedback] = useState("");
  const [rowError, setRowError] = useState<string | null>(null);

  // `running` rows are watchable, never actionable — enforced here (not just
  // by the "Needs you" section passing showActions={false}) so this holds
  // regardless of which section a row ends up rendered in.
  const isRunning = session.status === "running";
  const canDecide = showActions && !isRunning;

  async function commit(action: DecisionAction) {
    setPending(action);
    setRowError(null);
    try {
      await onDecide(session.id, action, feedback);
      setConfirming(null);
    } catch (e) {
      setRowError((e as Error).message || "Action failed.");
    } finally {
      setPending(null);
    }
  }

  return (
    <li
      className={`rounded-xl border px-4 py-3 ${
        isRunning
          ? "border-white/5 bg-white/[0.01] opacity-70"
          : "border-white/10 bg-white/[0.02]"
      }`}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-start justify-between gap-3 text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-mono text-sm text-zinc-100">
              {session.name}
            </span>
            <StatusPill session={session} />
          </div>
          {/* Always-visible summary: project · wave · branch · machine ·
              model · relative time — none of this should require expanding. */}
          <p className="mt-1 truncate text-xs text-zinc-400">
            {session.project ?? "—"} · {session.wave_name ?? "ungrouped"} ·{" "}
            {session.branch ?? "—"} · {session.machine_name ?? "—"} ·{" "}
            {session.model ?? "—"} · {timeAgo(primaryTimestamp(session))}
          </p>
          {session.last_message && (
            <p className="mt-1 truncate text-xs text-zinc-500">
              {session.last_message}
            </p>
          )}
        </div>
        <span className="mt-0.5 shrink-0 text-xs text-zinc-500">
          {expanded ? "▲" : "▼"}
        </span>
      </button>

      {expanded && (
        <div className="mt-3 space-y-2 border-t border-white/10 pt-3 text-xs text-zinc-400">
          {session.directive && (
            <p>
              <span className="text-zinc-500">Directive: </span>
              <span className="whitespace-pre-wrap text-zinc-300">
                {session.directive}
              </span>
            </p>
          )}
          {session.prompt_ref && (
            <p>
              <span className="text-zinc-500">Prompt: </span>
              {session.prompt_ref}
            </p>
          )}
          {session.last_message && (
            <p>
              <span className="text-zinc-500">Last message: </span>
              <span className="whitespace-pre-wrap text-zinc-300">
                {session.last_message}
              </span>
            </p>
          )}
          {session.latest_decision?.feedback && (
            <p>
              <span className="text-zinc-500">Feedback: </span>
              <span className="whitespace-pre-wrap text-zinc-300">
                {session.latest_decision.feedback}
              </span>
            </p>
          )}
          <p className="text-zinc-500">
            Dispatched {timeAgo(session.dispatched_at)} · Started{" "}
            {timeAgo(session.started_at)} · Ended {timeAgo(session.ended_at)}
          </p>
          <div className="flex gap-3">
            {session.rc_url && (
              <a
                href={session.rc_url}
                target="_blank"
                rel="noreferrer"
                className="text-indigo-300 underline underline-offset-2"
              >
                Open /rc
              </a>
            )}
            {session.pr_url && (
              <a
                href={session.pr_url}
                target="_blank"
                rel="noreferrer"
                className="text-indigo-300 underline underline-offset-2"
              >
                Open PR
              </a>
            )}
          </div>
        </div>
      )}

      {canDecide && (
        <div className="mt-3 border-t border-white/10 pt-3">
          {rowError && (
            <p className="mb-2 text-xs text-rose-400">{rowError}</p>
          )}

          {confirming === "redispatch_with_feedback" ? (
            <div className="space-y-2">
              <textarea
                autoFocus
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder="What should change on redispatch?"
                rows={3}
                className="w-full rounded-lg border border-white/10 bg-white/[0.03] p-2 text-sm text-zinc-100 outline-none focus:border-indigo-400/50"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={!feedback.trim() || pending !== null}
                  onClick={() => commit("redispatch_with_feedback")}
                  className="min-h-9 rounded-lg bg-amber-500 px-3 text-sm font-medium text-zinc-950 disabled:opacity-50"
                >
                  {pending === "redispatch_with_feedback"
                    ? "Sending…"
                    : "Confirm redispatch"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setConfirming(null);
                    setFeedback("");
                  }}
                  className="min-h-9 rounded-lg border border-white/10 px-3 text-sm text-zinc-300"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : confirming ? (
            <div className="flex gap-2">
              <button
                type="button"
                disabled={pending !== null}
                onClick={() => commit(confirming)}
                className={`min-h-9 rounded-lg px-3 text-sm font-medium disabled:opacity-50 ${
                  confirming === "reject"
                    ? "bg-rose-500 text-white"
                    : "bg-emerald-500 text-zinc-950"
                }`}
              >
                {pending
                  ? "Working…"
                  : `Confirm ${confirming === "reject" ? "reject" : "approve"}`}
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
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function Section({
  title,
  emptyText,
  sessions,
  showActions,
  onDecide,
}: {
  title: string;
  emptyText: string;
  sessions: InboxSession[];
  showActions: boolean;
  onDecide: (
    id: string,
    action: DecisionAction,
    feedback?: string,
  ) => Promise<void>;
}) {
  return (
    <section>
      <h2 className="text-sm font-semibold text-zinc-200">
        {title}{" "}
        <span className="font-normal text-zinc-500">
          ({sessions.length})
        </span>
      </h2>
      {sessions.length === 0 ? (
        <p className="mt-2 text-sm text-zinc-500">{emptyText}</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {sessions.map((s) => (
            <SessionRow
              key={s.id}
              session={s}
              showActions={showActions}
              onDecide={onDecide}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

export function InboxView({ initialGroups }: { initialGroups: InboxGroups }) {
  const [groups, setGroups] = useState(initialGroups);
  const inFlight = useRef(false);
  const router = useRouter();

  useEffect(() => {
    const interval = setInterval(async () => {
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        const res = await fetchOrRedirectToLogin(
          "/api/inbox",
          () => router.push("/login"),
          { cache: "no-store" },
        );
        if (res?.ok) {
          const next = (await res.json()) as InboxGroups;
          setGroups(next);
        }
        // Transient failures (network blip, 5xx) just keep the last good
        // render — no error UI for a background poll, next tick retries.
        // A session-expired redirect is handled above (router.push), not
        // treated as a transient failure.
      } catch {
        // ignore; retried on next tick
      } finally {
        inFlight.current = false;
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function handleDecide(
    id: string,
    action: DecisionAction,
    feedback?: string,
  ) {
    const path =
      action === "approve_merge"
        ? "approve"
        : action === "reject"
          ? "reject"
          : "redispatch";
    const res = await fetchOrRedirectToLogin(
      `/api/sessions/${id}/${path}`,
      () => router.push("/login"),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: action === "redispatch_with_feedback" ? JSON.stringify({ feedback }) : undefined,
      },
    );
    if (!res) {
      // Session expired mid-action; redirect to /login already triggered.
      throw new Error("Your session expired. Redirecting to sign in…");
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(decisionErrorMessage(body.error, res.status));
    }
    // Re-fetch immediately so the decided session moves groups without
    // waiting for the next poll tick.
    const refreshed = await fetchOrRedirectToLogin(
      "/api/inbox",
      () => router.push("/login"),
      { cache: "no-store" },
    );
    if (refreshed?.ok) {
      setGroups((await refreshed.json()) as InboxGroups);
    }
  }

  return (
    <div className="mt-8 space-y-8">
      <Section
        title="Needs you"
        emptyText="Nothing needs you right now."
        sessions={groups.needsYou}
        showActions={false}
        onDecide={handleDecide}
      />
      <Section
        title="Awaiting review"
        emptyText="No sessions awaiting review."
        sessions={groups.awaitingReview}
        showActions={true}
        onDecide={handleDecide}
      />
      <Section
        title="Recently decided"
        emptyText="No decisions yet."
        sessions={groups.recentlyDecided}
        showActions={false}
        onDecide={handleDecide}
      />
    </div>
  );
}
