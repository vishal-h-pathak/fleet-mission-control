import type { DerivedStatus } from "./types";

/** Online <30s since last heartbeat, stale <2m, else offline (mirrors the DB view). */
export function deriveStatus(lastHeartbeatTs: string | null): DerivedStatus {
  if (!lastHeartbeatTs) return "offline";
  const ageMs = Date.now() - new Date(lastHeartbeatTs).getTime();
  if (ageMs < 30_000) return "online";
  if (ageMs < 120_000) return "stale";
  return "offline";
}

export function relativeTime(ts: string | null): string {
  if (!ts) return "never";
  const sec = Math.round((Date.now() - new Date(ts).getTime()) / 1000);
  if (sec < 0) return "just now";
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}

export function formatUptime(seconds: number | null): string {
  if (seconds == null) return "—";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function formatGb(mb: number | null): string {
  if (mb == null) return "—";
  return `${(mb / 1024).toFixed(1)}GB`;
}

export function formatPct(pct: number | null): string {
  if (pct == null) return "—";
  return `${Math.round(pct)}%`;
}

export function formatEta(seconds: number | null | undefined): string | null {
  if (seconds == null) return null;
  if (seconds <= 0) return "done";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
