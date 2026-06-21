"use client";

import { useMemo } from "react";
import type { JobMetric } from "@/lib/types";

// Compact, dependency-free fitness sparkline. Inline SVG (no Recharts) to stay
// light and fast on the public plane. Plots best_fitness — and mean_fitness when
// present — against gen. The SVG scales to its container via a viewBox, so it
// stays crisp and full-width down to 390px.

const VIEW_W = 240;
const VIEW_H = 40;
const PAD = 3;

function buildPath(
  points: { gen: number; value: number }[],
  minGen: number,
  genSpan: number,
  minVal: number,
  valSpan: number,
): string {
  return points
    .map((p, i) => {
      const x = PAD + ((p.gen - minGen) / genSpan) * (VIEW_W - 2 * PAD);
      // SVG y grows downward; invert so higher fitness sits higher.
      const y =
        VIEW_H - PAD - ((p.value - minVal) / valSpan) * (VIEW_H - 2 * PAD);
      return `${i === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

export default function Sparkline({ metrics }: { metrics: JobMetric[] }) {
  const model = useMemo(() => {
    // Order by gen (fall back to ts ordering for null-gen ad-hoc points).
    const rows = [...metrics]
      .filter((m) => m.best_fitness != null || m.mean_fitness != null)
      .sort((a, b) => {
        if (a.gen != null && b.gen != null) return a.gen - b.gen;
        return new Date(a.ts).getTime() - new Date(b.ts).getTime();
      })
      .map((m, i) => ({ ...m, gen: m.gen ?? i }));

    if (rows.length === 0) return null;

    const best = rows
      .filter((m) => m.best_fitness != null)
      .map((m) => ({ gen: m.gen as number, value: m.best_fitness as number }));
    const mean = rows
      .filter((m) => m.mean_fitness != null)
      .map((m) => ({ gen: m.gen as number, value: m.mean_fitness as number }));

    const all = [...best, ...mean];
    const gens = all.map((p) => p.gen);
    const vals = all.map((p) => p.value);
    const minGen = Math.min(...gens);
    const maxGen = Math.max(...gens);
    const minVal = Math.min(...vals);
    const maxVal = Math.max(...vals);
    const genSpan = maxGen - minGen || 1;
    const valSpan = maxVal - minVal || 1;

    const latestBest =
      best.length > 0 ? best[best.length - 1].value : null;
    const latestGen = rows[rows.length - 1].gen as number;

    return {
      bestPath: best.length > 1 ? buildPath(best, minGen, genSpan, minVal, valSpan) : null,
      meanPath: mean.length > 1 ? buildPath(mean, minGen, genSpan, minVal, valSpan) : null,
      latestBest,
      latestGen,
      single: best.length === 1 ? best[0] : null,
    };
  }, [metrics]);

  if (!model) return null;

  return (
    <div className="mt-2">
      <div className="mb-1 flex items-baseline justify-between text-[11px] text-zinc-400">
        <span>fitness</span>
        {model.latestBest != null && (
          <span>
            best{" "}
            <span className="font-mono text-zinc-200">
              {model.latestBest.toPrecision(4)}
            </span>
            <span className="ml-1 text-zinc-600">@ gen {model.latestGen}</span>
          </span>
        )}
      </div>
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="none"
        className="block h-10 w-full overflow-visible rounded-md bg-white/[0.02]"
        role="img"
        aria-label="fitness over generations"
      >
        {model.meanPath && (
          <path
            d={model.meanPath}
            fill="none"
            stroke="rgb(113 113 122)"
            strokeWidth={1}
            strokeDasharray="2 2"
            vectorEffect="non-scaling-stroke"
          />
        )}
        {model.bestPath && (
          <path
            d={model.bestPath}
            fill="none"
            stroke="rgb(129 140 248)"
            strokeWidth={1.5}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        )}
        {model.single && (
          <circle
            cx={VIEW_W / 2}
            cy={VIEW_H / 2}
            r={2}
            fill="rgb(129 140 248)"
          />
        )}
      </svg>
    </div>
  );
}
