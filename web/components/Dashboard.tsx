"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { getBrowserClient } from "@/lib/supabase/client";
import type { Job, MachineStatus } from "@/lib/types";
import { deriveStatus } from "@/lib/format";
import MachineCard from "./MachineCard";
import LiveIndicator, { type ConnState } from "./LiveIndicator";

const RECENTLY_ENDED_MS = 30 * 60 * 1000;
const SAFETY_REFETCH_MS = 20_000;

function isDisplayable(job: Job): boolean {
  if (job.status === "running") return true;
  const ended = job.ended_at ?? job.updated_at;
  if (!ended) return false;
  return Date.now() - new Date(ended).getTime() < RECENTLY_ENDED_MS;
}

export default function Dashboard({
  initialMachines,
  initialJobs,
  initialAuthed,
}: {
  initialMachines: MachineStatus[];
  initialJobs: Job[];
  initialAuthed: boolean;
}) {
  const [machines, setMachines] = useState<MachineStatus[]>(initialMachines);
  const [jobs, setJobs] = useState<Job[]>(initialJobs);
  const [conn, setConn] = useState<ConnState>("connecting");
  const [, setTick] = useState(0);

  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refetch = useCallback(async () => {
    const supabase = getBrowserClient();
    const [m, j] = await Promise.all([
      supabase.from("fleet_machine_status").select("*").order("name"),
      supabase
        .from("fleet_jobs")
        .select("*")
        .order("updated_at", { ascending: false })
        .limit(200),
    ]);
    if (m.data) setMachines(m.data as MachineStatus[]);
    if (j.data) setJobs(j.data as Job[]);
  }, []);

  const scheduleRefetch = useCallback(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(refetch, 400);
  }, [refetch]);

  useEffect(() => {
    const supabase = getBrowserClient();
    let channel: RealtimeChannel | null = null;

    const tables = ["fleet_heartbeats", "fleet_jobs", "fleet_machines"];
    channel = supabase.channel("fleet-realtime");
    for (const table of tables) {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        () => scheduleRefetch(),
      );
    }
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") setConn("live");
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT")
        setConn("reconnecting");
      else if (status === "CLOSED") setConn("reconnecting");
    });

    // Live clock: recompute relative times / status decay every second.
    const tickId = setInterval(() => setTick((t) => t + 1), 1000);
    // Safety net for any missed realtime event.
    const refetchId = setInterval(refetch, SAFETY_REFETCH_MS);

    return () => {
      if (channel) supabase.removeChannel(channel);
      clearInterval(tickId);
      clearInterval(refetchId);
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [refetch, scheduleRefetch]);

  const jobsByMachine = useMemo(() => {
    const map = new Map<string, Job[]>();
    for (const job of jobs) {
      if (!isDisplayable(job)) continue;
      const list = map.get(job.machine_id) ?? [];
      list.push(job);
      map.set(job.machine_id, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => {
        if (a.status === "running" && b.status !== "running") return -1;
        if (b.status === "running" && a.status !== "running") return 1;
        return (
          new Date(b.updated_at ?? 0).getTime() -
          new Date(a.updated_at ?? 0).getTime()
        );
      });
    }
    return map;
  }, [jobs]);

  const onlineCount = machines.filter(
    (m) => deriveStatus(m.last_heartbeat_ts) === "online",
  ).length;
  const runningCount = jobs.filter((j) => j.status === "running").length;

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-50 sm:text-2xl">
            Fleet Mission Control
          </h1>
          <p className="mt-0.5 text-sm text-zinc-400">
            {machines.length} machine{machines.length === 1 ? "" : "s"} ·{" "}
            {onlineCount} online · {runningCount} running
          </p>
        </div>
        <div className="flex items-center gap-3">
          <LiveIndicator state={conn} />
          {initialAuthed ? (
            <button
              type="button"
              onClick={async () => {
                await fetch("/api/auth/logout", { method: "POST" });
                location.reload();
              }}
              className="rounded-lg border border-white/10 px-2.5 py-1 text-xs text-zinc-400 hover:bg-white/5"
            >
              Sign out
            </button>
          ) : (
            <a
              href="/login"
              className="rounded-lg border border-white/10 px-2.5 py-1 text-xs text-zinc-400 hover:bg-white/5"
            >
              Sign in
            </a>
          )}
        </div>
      </header>

      {machines.length === 0 ? (
        <p className="rounded-xl border border-white/5 bg-white/[0.02] p-6 text-center text-sm text-zinc-500">
          No machines registered yet.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {machines.map((m) => (
            <MachineCard
              key={m.id}
              machine={m}
              jobs={jobsByMachine.get(m.id) ?? []}
              authed={initialAuthed}
            />
          ))}
        </div>
      )}
    </main>
  );
}
