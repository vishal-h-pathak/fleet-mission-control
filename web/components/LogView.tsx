"use client";

import { useState } from "react";
import type { JobLog } from "@/lib/types";

// "Logs" affordance, gated exactly like RemoteControlButton. log_tail is
// sensitive, so unauthed viewers get a sign-in prompt; authed viewers fetch from
// the server-only /api/job/[id]/log route. Fetch on open + a manual refresh
// button — no aggressive polling.
export default function LogView({
  jobId,
  authed,
}: {
  jobId: string;
  authed: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<
    "idle" | "loading" | "needsAuth" | "error" | "empty"
  >("idle");
  const [lines, setLines] = useState<string | null>(null);

  async function load() {
    setState("loading");
    try {
      const res = await fetch(`/api/job/${jobId}/log`, { cache: "no-store" });
      if (res.status === 401) {
        setState("needsAuth");
        return;
      }
      if (res.status === 404) {
        setLines(null);
        setState("empty");
        return;
      }
      if (!res.ok) {
        setState("error");
        return;
      }
      const data = (await res.json()) as JobLog;
      const tail = (data.log_tail ?? "").trimEnd();
      setLines(tail);
      setState(tail ? "idle" : "empty");
    } catch {
      setState("error");
    }
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && lines == null && state !== "loading") load();
  }

  if (!authed || state === "needsAuth") {
    return (
      <a
        href="/login"
        className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 text-sm font-medium text-zinc-300 transition hover:bg-white/10"
      >
        🔒 Sign in to view logs
      </a>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={toggle}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 text-sm font-medium text-zinc-300 transition hover:bg-white/10"
          aria-expanded={open}
        >
          {open ? "▾ Logs" : "▸ Logs"}
        </button>
        {open && (
          <button
            type="button"
            onClick={load}
            disabled={state === "loading"}
            className="inline-flex min-h-9 items-center rounded-lg border border-white/10 px-2.5 text-xs text-zinc-400 transition hover:bg-white/5 disabled:opacity-60"
          >
            {state === "loading" ? "Loading…" : "↻ Refresh"}
          </button>
        )}
      </div>

      {open && (
        <div className="mt-2">
          {state === "error" ? (
            <p className="text-xs text-rose-300">
              Failed to load logs.{" "}
              <button
                type="button"
                onClick={load}
                className="underline hover:text-rose-200"
              >
                Retry
              </button>
            </p>
          ) : state === "empty" ? (
            <p className="text-xs text-zinc-600">No log output captured.</p>
          ) : lines ? (
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-white/5 bg-black/40 p-2.5 font-mono text-[11px] leading-relaxed text-zinc-300">
              {lines}
            </pre>
          ) : (
            <p className="text-xs text-zinc-600">Loading…</p>
          )}
        </div>
      )}
    </div>
  );
}
