"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { getBrowserClient } from "@/lib/supabase/client";
import type { Job, JobMetric, MachineStatus } from "@/lib/types";
import { deriveStatus } from "@/lib/format";
import MachineCard from "./MachineCard";
import LiveIndicator, { type ConnState } from "./LiveIndicator";
import DispatchPanel from "./DispatchPanel";

const RECENTLY_ENDED_MS = 30 * 60 * 1000;
const SAFETY_REFETCH_MS = 20_000;

function isDisplayable(job: Job): boolean {
  if (job.status === "running") return true;
  const ended = job.ended_at ?? job.updated_at;
  if (!ended) return false;
  return Date.now() - new Date(ended).getTime() < RECENTLY_ENDED_MS;
}

// Group flat metric rows into a per-job map, ordered by gen (Sparkline re-sorts
// defensively too). Returns a fresh Map so React sees a new reference.
function indexMetrics(rows: JobMetric[]): Map<string, JobMetric[]> {
  const map = new Map<string, JobMetric[]>();
  for (const r of rows) {
    const list = map.get(r.job_id) ?? [];
    list.push(r);
    map.set(r.job_id, list);
  }
  return map;
}

// Merge one realtime-inserted point into the map, de-duped on gen so an upsert
// re-emitting a generation replaces rather than doubles it. Live-growth path.
function mergeMetric(
  prev: Map<string, JobMetric[]>,
  row: JobMetric,
): Map<string, JobMetric[]> {
  const next = new Map(prev);
  const list = next.get(row.job_id) ?? [];
  const filtered =
    row.gen == null ? list : list.filter((m) => m.gen !== row.gen);
  next.set(row.job_id, [...filtered, row]);
  return next;
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
  const [metricsByJob, setMetricsByJob] = useState<Map<string, JobMetric[]>>(
    () => new Map(),
  );
  const [conn, setConn] = useState<ConnState>("connecting");
  const [, setTick] = useState(0);

  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch the fitness time-series for the jobs currently on screen. Public
  // table, anon key. Scoped to displayable jobs so we never pull the full
  // history for long-gone runs.
  const refetchMetrics = useCallback(async (current: Job[]) => {
    const ids = current.filter(isDisplayable).map((j) => j.id);
    if (ids.length === 0) {
      setMetricsByJob(new Map());
      return;
    }
    const supabase = getBrowserClient();
    const { data } = await supabase
      .from("fleet_job_metrics")
      .select("job_id, ts, gen, best_fitness, mean_fitness")
      .in("job_id", ids)
      .order("gen", { ascending: true })
      .limit(5000);
    if (data) setMetricsByJob(indexMetrics(data as JobMetric[]));
  }, []);

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
    if (j.data) {
      const next = j.data as Job[];
      setJobs(next);
      void refetchMetrics(next);
    }
  }, [refetchMetrics]);

  const scheduleRefetch = useCallback(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(refetch, 400);
  }, [refetch]);

  useEffect(() => {
    const supabase = getBrowserClient();
    let channel: RealtimeChannel | null = null;

    // Initial pull for the jobs rendered on first paint.
    void refetchMetrics(initialJobs);

    const tables = ["fleet_heartbeats", "fleet_jobs", "fleet_machines"];
    channel = supabase.channel("fleet-realtime");
    for (const table of tables) {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        () => scheduleRefetch(),
      );
    }
    // Metrics get their own handler: append each inserted point straight into
    // state so a running job's sparkline grows live, without a full refetch.
    channel.on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "fleet_job_metrics" },
      (payload) => {
        setMetricsByJob((prev) => mergeMetric(prev, payload.new as JobMetric));
      },
    );
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
  }, [refetch, scheduleRefetch, refetchMetrics, initialJobs]);

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

      {/* Authed-only control plane. Unauthed viewers never see the dispatch UI
          or any command history — fleet_commands is deny-all to anon. */}
      {initialAuthed && <DispatchPanel machines={machines} />}

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
              metricsByJob={metricsByJob}
            />
          ))}
        </div>
      )}
    </main>
  );
}
