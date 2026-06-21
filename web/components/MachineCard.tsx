"use client";

import type { Job, MachineStatus } from "@/lib/types";
import {
  deriveStatus,
  formatGb,
  formatPct,
  formatUptime,
  relativeTime,
} from "@/lib/format";
import JobItem from "./JobItem";

const STATUS_META: Record<string, { dot: string; label: string; ring: string }> = {
  online: { dot: "bg-emerald-400", label: "online", ring: "border-emerald-400/30" },
  stale: { dot: "bg-amber-400", label: "stale", ring: "border-amber-400/30" },
  offline: { dot: "bg-zinc-500", label: "offline", ring: "border-white/10" },
};

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white/[0.03] px-2.5 py-2">
      <div className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="mt-0.5 font-mono text-sm text-zinc-100">{value}</div>
    </div>
  );
}

export default function MachineCard({
  machine,
  jobs,
  authed,
}: {
  machine: MachineStatus;
  jobs: Job[];
  authed: boolean;
}) {
  // Recompute status client-side from the last heartbeat so it decays live
  // (online → stale → offline) without waiting for a new row.
  const status = deriveStatus(machine.last_heartbeat_ts);
  const meta = STATUS_META[status] ?? STATUS_META.offline;
  const gpus = Array.isArray(machine.gpu) ? machine.gpu : [];

  return (
    <section
      className={`rounded-2xl border ${meta.ring} bg-white/[0.02] p-4 shadow-lg shadow-black/20`}
    >
      <header className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-zinc-50">{machine.name}</h2>
          <p className="text-xs text-zinc-500">
            {machine.kind}
            {machine.os ? ` · ${machine.os}` : ""}
            {machine.arch ? ` · ${machine.arch}` : ""}
          </p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-zinc-300">
          <span className={`h-2 w-2 rounded-full ${meta.dot}`} />
          {meta.label}
        </span>
      </header>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <Stat label="CPU" value={formatPct(machine.cpu_pct)} />
        <Stat
          label="RAM"
          value={
            machine.ram_used_mb != null && machine.ram_total_mb != null
              ? `${formatGb(machine.ram_used_mb)}/${formatGb(machine.ram_total_mb)}`
              : formatPct(machine.ram_pct)
          }
        />
        <Stat label="Uptime" value={formatUptime(machine.uptime_s)} />
        <Stat label="Last seen" value={relativeTime(machine.last_heartbeat_ts)} />
      </div>

      {gpus.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {gpus.map((g, i) => (
            <div
              key={g.index ?? i}
              className="flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-lg bg-white/[0.03] px-2.5 py-2 text-[11px] text-zinc-400"
            >
              <span className="font-medium text-zinc-200">
                {g.name ?? `GPU ${g.index ?? i}`}
              </span>
              {g.util_pct != null && <span>util {Math.round(g.util_pct)}%</span>}
              {g.mem_used_mb != null && g.mem_total_mb != null && (
                <span>
                  mem {formatGb(g.mem_used_mb)}/{formatGb(g.mem_total_mb)}
                </span>
              )}
              {g.temp_c != null && <span>{Math.round(g.temp_c)}°C</span>}
            </div>
          ))}
        </div>
      )}

      <div className="mt-4">
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
          Jobs{jobs.length > 0 ? ` · ${jobs.length}` : ""}
        </h3>
        {jobs.length === 0 ? (
          <p className="text-xs text-zinc-600">No active jobs.</p>
        ) : (
          <ul className="space-y-2">
            {jobs.map((job) => (
              <JobItem key={job.id} job={job} authed={authed} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
