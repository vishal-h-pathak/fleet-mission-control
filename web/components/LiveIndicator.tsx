"use client";

export type ConnState = "connecting" | "live" | "reconnecting";

const MAP: Record<ConnState, { label: string; dot: string; text: string }> = {
  connecting: { label: "Connecting", dot: "bg-amber-400", text: "text-amber-300" },
  live: { label: "Live", dot: "bg-emerald-400", text: "text-emerald-300" },
  reconnecting: { label: "Reconnecting", dot: "bg-amber-400", text: "text-amber-300" },
};

export default function LiveIndicator({ state }: { state: ConnState }) {
  const s = MAP[state];
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs font-medium ${s.text}`}
      title={`Realtime: ${s.label}`}
    >
      <span className="relative flex h-2 w-2">
        {state === "live" && (
          <span
            className={`absolute inline-flex h-full w-full animate-ping rounded-full ${s.dot} opacity-60`}
          />
        )}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${s.dot}`} />
      </span>
      {s.label}
    </span>
  );
}
