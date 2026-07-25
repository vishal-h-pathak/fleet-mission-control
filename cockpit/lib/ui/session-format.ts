// cockpit/lib/ui/session-format.ts
// Shared client-side view helpers for both the Inbox (app/inbox-view.tsx)
// and the Waves board (app/waves/waves-view.tsx) — session status coloring,
// relative-time formatting, and the redirect-aware poll/decision fetch
// wrapper. Extracted rather than duplicated per-view because these aren't
// cosmetic: STATUS_STYLE gains a status (e.g. a future `lost`) the moment a
// sibling migration lands, and fetchOrRedirectToLogin embodies the
// session-expiry fix from wave 1's Inbox review — duplicated, both would
// need the same fix twice and would drift.

import type { SessionStatus } from "@/lib/inbox/types";

export function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "—";
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

// All eight statuses get an entry — the Inbox never renders `planned` (it
// excludes those sessions), but the Waves board does, so this map has to
// cover it anyway.
export const STATUS_STYLE: Record<SessionStatus, string> = {
  planned: "bg-zinc-500/15 text-zinc-300 border-zinc-400/30",
  running: "bg-sky-500/15 text-sky-300 border-sky-400/30",
  waiting: "bg-amber-500/15 text-amber-300 border-amber-400/30",
  done: "bg-indigo-500/15 text-indigo-300 border-indigo-400/30",
  reviewed: "bg-emerald-500/15 text-emerald-300 border-emerald-400/30",
  merged: "bg-emerald-500/15 text-emerald-300 border-emerald-400/30",
  rejected: "bg-rose-500/15 text-rose-300 border-rose-400/30",
  lost: "bg-neutral-500/15 text-neutral-400 border-neutral-400/30",
};

// proxy.ts 302-redirects to /login whenever the Supabase session is
// missing/expired. Plain fetch() follows redirects by default, so an
// expired-session response would otherwise come back as a 200 with the
// /login page's HTML body — res.ok true, but .json() throws on it (or
// parses garbage). `redirect: "manual"` stops the browser from following
// the redirect and instead hands back an opaque response (`type:
// "opaqueredirect"`, `status: 0`); treat that as "signed out" and invoke
// `redirectToLogin` instead of freezing the poll or surfacing a JSON-parse
// error. Takes the redirect callback as a parameter (rather than importing
// `next/navigation` itself) so callers supply their own `router.push`.
export async function fetchOrRedirectToLogin(
  url: string,
  redirectToLogin: () => void,
  init?: RequestInit,
): Promise<Response | null> {
  const res = await fetch(url, { ...init, redirect: "manual" });
  if (res.type === "opaqueredirect" || res.status === 0) {
    redirectToLogin();
    return null;
  }
  return res;
}
