"use client";

import type { Job, JobMetric } from "@/lib/types";
import { formatEta, relativeTime } from "@/lib/format";
import RemoteControlButton from "./RemoteControlButton";
import Sparkline from "./Sparkline";
import LogView from "./LogView";

const STATUS_STYLE: Record<string, string> = {
  running: "bg-emerald-500/15 text-emerald-300 border-emerald-400/30",
  finished: "bg-sky-500/15 text-sky-300 border-sky-400/30",
  failed: "bg-rose-500/15 text-rose-300 border-rose-400/30",
  stopped: "bg-zinc-500/15 text-zinc-300 border-zinc-400/30",
  unknown: "bg-zinc-500/15 text-zinc-400 border-zinc-400/20",
};

export default function JobItem({
  job,
  authed,
  metrics,
}: {
  job: Job;
  authed: boolean;
  metrics: JobMetric[];
}) {
  const p = job.progress ?? {};
  const hasBar =
    typeof p.gens_total === "number" && p.gens_total > 0 &&
    typeof p.gens_done === "number";
  const pct = hasBar
    ? Math.min(100, Math.round(((p.gens_done as number) / (p.gens_total as number)) * 100))
    : null;
  const eta = formatEta(p.eta_s as number | undefined);
  const badge = STATUS_STYLE[job.status] ?? STATUS_STYLE.unknown;

  return (
    <li className="rounded-xl border border-white/5 bg-black/20 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm text-zinc-100 break-all">{job.name}</span>
        <span
          className={`rounded-md border px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide ${badge}`}
        >
          {job.status}
        </span>
        {job.kind && (
          <span className="text-[11px] text-zinc-500">{job.kind}</span>
        )}
      </div>

      <div className="mt-0.5 text-xs text-zinc-400">
        {job.project ? <span>{job.project}</span> : <span>—</span>}
        <span className="mx-1.5 text-zinc-600">·</span>
        <span>
          {job.status === "running"
            ? `updated ${relativeTime(job.updated_at)}`
            : `ended ${relativeTime(job.ended_at ?? job.updated_at)}`}
        </span>
      </div>

      {(hasBar || typeof p.best_fitness === "number" || eta) && (
        <div className="mt-2 space-y-1.5">
          {hasBar && (
            <div>
              <div className="mb-1 flex justify-between text-[11px] text-zinc-400">
                <span>
                  gen {p.gens_done as number}/{p.gens_total as number}
                </span>
                <span>{pct}%</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-indigo-400 transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          )}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-zinc-400">
            {typeof p.best_fitness === "number" && (
              <span>
                best fitness{" "}
                <span className="font-mono text-zinc-200">
                  {(p.best_fitness as number).toPrecision(4)}
                </span>
              </span>
            )}
            {eta && (
              <span>
                ETA <span className="font-mono text-zinc-200">{eta}</span>
              </span>
            )}
          </div>
        </div>
      )}

      {metrics.length > 0 && <Sparkline metrics={metrics} />}

      <div className="mt-3 flex flex-wrap items-start gap-2">
        <RemoteControlButton jobId={job.id} authed={authed} />
        <LogView jobId={job.id} authed={authed} />
      </div>
    </li>
  );
}
