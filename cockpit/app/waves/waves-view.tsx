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
  confirmed: "bg-violet-500/15 text-violet-300 border-violet-400/30",
  launching: "bg-amber-500/15 text-amber-300 border-amber-400/30",
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
          {/* M4 dispatch: launch bookkeeping, only present once an agent has
              touched this session (claimed_at is the advisory-lock stamp). */}
          {session.claimed_at && (
            <p className="mt-1 truncate text-xs text-zinc-500">
              claimed {timeAgo(session.claimed_at)}
              {session.launched_at && ` · launched ${timeAgo(session.launched_at)}`}
              {session.launch_error && (
                <span className="text-rose-400"> · launch failed: {session.launch_error}</span>
              )}
            </p>
          )}
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
      {wave.confirmed_at && (
        <p className="mt-1 text-xs text-zinc-500">
          confirmed {timeAgo(wave.confirmed_at)}
          {wave.confirmed_by && ` by ${wave.confirmed_by}`}
        </p>
      )}
      {wave.launch_error && (
        <p className="mt-1 text-xs text-rose-400">{wave.launch_error}</p>
      )}
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
