"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FleetCommand, MachineStatus } from "@/lib/types";
import { relativeTime } from "@/lib/format";
import { VERBS, ALLOWED_VERBS, validateCommand } from "@/lib/commands/allowlist.mjs";

// Authed-only command dispatch. Rendered ONLY when the viewer holds the auth
// cookie (the parent never mounts it otherwise), and every byte it reads/writes
// goes through the service-role routes — fleet_commands is deny-all to anon.
//
// Verbs + arg shapes + validation all come from the SHARED allowlist module, the
// exact same file the agent uses, so the UI can never offer an off-list verb.

const POLL_MS = 3000;

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-amber-500/15 text-amber-300 border-amber-400/30",
  claimed: "bg-sky-500/15 text-sky-300 border-sky-400/30",
  running: "bg-emerald-500/15 text-emerald-300 border-emerald-400/30",
  done: "bg-emerald-500/15 text-emerald-300 border-emerald-400/30",
  error: "bg-rose-500/15 text-rose-300 border-rose-400/30",
  rejected: "bg-rose-500/15 text-rose-300 border-rose-400/30",
};

export default function DispatchPanel({
  machines,
}: {
  machines: MachineStatus[];
}) {
  const [machineId, setMachineId] = useState<string>(machines[0]?.id ?? "");
  const [verb, setVerb] = useState<string>(ALLOWED_VERBS[0] ?? "");
  const [args, setArgs] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [commands, setCommands] = useState<FleetCommand[]>([]);

  const argSpecs = useMemo(() => VERBS[verb]?.args ?? [], [verb]);

  // Reset args whenever the verb changes so stale fields don't leak across verbs.
  useEffect(() => {
    setArgs({});
  }, [verb]);

  // Client-side mirror of the server check, so the button disables on bad input
  // and the user gets immediate feedback. The server re-validates regardless.
  const validation = useMemo(
    () => validateCommand(verb, args),
    [verb, args],
  );

  const loadCommands = useCallback(async (mid: string) => {
    if (!mid) return;
    try {
      const res = await fetch(
        `/api/commands?machine_id=${encodeURIComponent(mid)}&limit=20`,
        { cache: "no-store" },
      );
      if (!res.ok) return;
      const data = (await res.json()) as { commands: FleetCommand[] };
      setCommands(data.commands ?? []);
    } catch {
      // Transient; the next poll tick retries.
    }
  }, []);

  // Poll the history for the selected machine while the panel is open.
  const machineIdRef = useRef(machineId);
  machineIdRef.current = machineId;
  useEffect(() => {
    setCommands([]);
    void loadCommands(machineId);
    const id = setInterval(() => loadCommands(machineIdRef.current), POLL_MS);
    return () => clearInterval(id);
  }, [machineId, loadCommands]);

  async function submit() {
    if (!machineId || !validation.ok) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ machine_id: machineId, verb, args }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          message?: string;
          error?: string;
        };
        setError(body.message ?? body.error ?? `Request failed (${res.status})`);
        return;
      }
      setArgs({});
      await loadCommands(machineId);
    } catch {
      setError("Network error — command not dispatched.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="mb-6 rounded-2xl border border-indigo-400/20 bg-indigo-500/[0.04] p-4">
      <header className="mb-3 flex items-center gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-indigo-200">
          Command dispatch
        </h2>
        <span className="text-[11px] text-zinc-500">authed · allowlisted</span>
      </header>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-[11px] text-zinc-400">
          Machine
          <select
            value={machineId}
            onChange={(e) => setMachineId(e.target.value)}
            className="min-w-44 rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 text-sm text-zinc-100"
          >
            {machines.length === 0 && <option value="">No machines</option>}
            {machines.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} ({m.kind})
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-[11px] text-zinc-400">
          Verb
          <select
            value={verb}
            onChange={(e) => setVerb(e.target.value)}
            className="rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 text-sm text-zinc-100"
          >
            {ALLOWED_VERBS.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>

        {argSpecs.map((a) => (
          <label
            key={a.name}
            className="flex flex-col gap-1 text-[11px] text-zinc-400"
          >
            {a.name}
            {a.required ? "" : " (optional)"}
            <input
              type="text"
              value={args[a.name] ?? ""}
              onChange={(e) =>
                setArgs((prev) => ({ ...prev, [a.name]: e.target.value }))
              }
              placeholder={a.name}
              className="rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 font-mono text-sm text-zinc-100"
            />
          </label>
        ))}

        <button
          type="button"
          onClick={submit}
          disabled={submitting || !machineId || !validation.ok}
          className="inline-flex min-h-9 items-center rounded-lg border border-indigo-400/30 bg-indigo-500/20 px-4 text-sm font-medium text-indigo-100 transition hover:bg-indigo-500/30 disabled:opacity-50"
        >
          {submitting ? "Dispatching…" : "Dispatch"}
        </button>
      </div>

      {!validation.ok && (Object.keys(args).length > 0 || argSpecs.some((a) => a.required)) && (
        <p className="mt-2 text-[11px] text-amber-300/80">{validation.error}</p>
      )}
      {error && <p className="mt-2 text-[11px] text-rose-300">{error}</p>}

      <div className="mt-4">
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
          Recent commands
        </h3>
        {commands.length === 0 ? (
          <p className="text-xs text-zinc-600">No commands dispatched yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {commands.map((c) => (
              <li
                key={c.id}
                className="rounded-lg border border-white/5 bg-black/20 p-2.5 text-xs"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-zinc-100">{c.verb}</span>
                  {c.args && Object.keys(c.args).length > 0 && (
                    <span className="font-mono text-[11px] text-zinc-500">
                      {JSON.stringify(c.args)}
                    </span>
                  )}
                  <span
                    className={`rounded-md border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                      STATUS_STYLE[c.status] ?? STATUS_STYLE.pending
                    }`}
                  >
                    {c.status}
                  </span>
                  {c.exit_code != null && (
                    <span className="text-[11px] text-zinc-500">
                      exit {c.exit_code}
                    </span>
                  )}
                  <span className="ml-auto text-[11px] text-zinc-600">
                    {relativeTime(c.created_at)}
                  </span>
                </div>
                {c.result != null && (
                  <pre className="mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md border border-white/5 bg-black/40 p-2 font-mono text-[10px] leading-relaxed text-zinc-400">
                    {typeof c.result === "string"
                      ? c.result
                      : JSON.stringify(c.result, null, 2)}
                  </pre>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
