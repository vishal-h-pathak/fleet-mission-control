"use client";

import { useState } from "react";
import type { JobLinks } from "@/lib/types";

// The "join" affordance: tap a job → fetch its /rc URL from the authed,
// server-only route → drop into Anthropic's native remote control.
// When unauthed the server returns 401 and we show a sign-in prompt instead.
export default function RemoteControlButton({
  jobId,
  authed,
}: {
  jobId: string;
  authed: boolean;
}) {
  const [state, setState] = useState<
    "idle" | "loading" | "needsAuth" | "error" | "none"
  >("idle");
  const [link, setLink] = useState<JobLinks | null>(null);

  async function reveal() {
    setState("loading");
    try {
      const res = await fetch(`/api/job/${jobId}/links`, {
        cache: "no-store",
      });
      if (res.status === 401) {
        setState("needsAuth");
        return;
      }
      if (res.status === 404) {
        setState("none");
        return;
      }
      if (!res.ok) {
        setState("error");
        return;
      }
      const data = (await res.json()) as JobLinks;
      setLink(data);
      setState("idle");
      if (data.rc_url) {
        window.open(data.rc_url, "_blank", "noopener,noreferrer");
      } else {
        setState("none");
      }
    } catch {
      setState("error");
    }
  }

  if (!authed || state === "needsAuth") {
    return (
      <a
        href="/login"
        className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 text-sm font-medium text-zinc-300 transition hover:bg-white/10"
      >
        🔒 Sign in to open remote control
      </a>
    );
  }

  if (link?.rc_url) {
    return (
      <a
        href={link.rc_url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-indigo-400/30 bg-indigo-500/15 px-3 text-sm font-medium text-indigo-200 transition hover:bg-indigo-500/25"
      >
        ↗ Open in remote control
      </a>
    );
  }

  return (
    <button
      type="button"
      onClick={reveal}
      disabled={state === "loading"}
      className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-indigo-400/30 bg-indigo-500/15 px-3 text-sm font-medium text-indigo-200 transition hover:bg-indigo-500/25 disabled:opacity-60"
    >
      {state === "loading"
        ? "Loading…"
        : state === "none"
          ? "No remote-control link"
          : state === "error"
            ? "Retry remote control"
            : "Open in remote control"}
    </button>
  );
}
