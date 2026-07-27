"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { fetchOrRedirectToLogin } from "@/lib/ui/session-format";
import { composeDirective } from "@/lib/compose/directive.mjs";
import {
  MODELS,
  isArmed,
  isValidBranch,
  isValidSessionName,
  isValidWaveName,
  promptSlug,
} from "@/lib/compose/validate.mjs";
import type { ComposeMachine, ComposeProject } from "@/lib/projects/data";
import type { PromptFile } from "@/lib/github/prompts";

type Model = "haiku" | "sonnet" | "opus";
type Step = "project" | "chunks" | "preview" | "confirm";

interface ChunkDraft {
  promptPath: string;
  promptName: string;
  sessionName: string;
  branch: string;
  machineId: string;
  model: Model;
}

function chunkIssues(chunk: ChunkDraft): string[] {
  const issues: string[] = [];
  if (!isValidSessionName(chunk.sessionName)) issues.push("invalid session name");
  if (!isValidBranch(chunk.branch)) issues.push("invalid branch");
  if (!chunk.machineId) issues.push("no machine selected");
  return issues;
}

export function ComposeView({
  initialProjects,
  initialMachines,
}: {
  initialProjects: ComposeProject[];
  initialMachines: ComposeMachine[];
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("project");

  const [projectId, setProjectId] = useState<string>("");
  const project = initialProjects.find((p) => p.id === projectId) ?? null;

  const [promptsLoading, setPromptsLoading] = useState(false);
  const [promptsConfigured, setPromptsConfigured] = useState(true);
  const [prompts, setPrompts] = useState<PromptFile[]>([]);
  const [promptsError, setPromptsError] = useState<string | null>(null);

  const [chunks, setChunks] = useState<ChunkDraft[]>([]);
  const [waveName, setWaveName] = useState("");
  const [notes, setNotes] = useState("");

  const [openPaths, setOpenPaths] = useState<Set<string>>(new Set());
  const [contentCache, setContentCache] = useState<Record<string, string>>({});

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ waveId: string; waveName: string } | null>(null);

  const [confirmTyped, setConfirmTyped] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [abandoning, setAbandoning] = useState(false);

  function machineName(id: string): string {
    return initialMachines.find((m) => m.id === id)?.name ?? "—";
  }

  async function selectProject(p: ComposeProject) {
    setProjectId(p.id);
    setChunks([]);
    setStep("chunks");
    setPromptsLoading(true);
    setPromptsError(null);
    const res = await fetchOrRedirectToLogin(
      `/api/compose/prompts?project_id=${p.id}`,
      () => router.push("/login"),
      { cache: "no-store" },
    );
    if (!res) return;
    if (!res.ok) {
      setPromptsError(`Failed to load prompts (${res.status}).`);
      setPromptsLoading(false);
      return;
    }
    const body = (await res.json()) as
      | { configured: false }
      | { configured: true; prompts: PromptFile[] }
      | { configured: true; error: string };
    if (!body.configured) {
      setPromptsConfigured(false);
      setPromptsLoading(false);
      return;
    }
    setPromptsConfigured(true);
    if ("prompts" in body) setPrompts(body.prompts);
    else setPromptsError(body.error);
    setPromptsLoading(false);
  }

  function togglePrompt(p: PromptFile) {
    const already = chunks.some((c) => c.promptPath === p.path);
    if (already) {
      setChunks((cs) => cs.filter((c) => c.promptPath !== p.path));
      return;
    }
    const slug = promptSlug(p.name) ?? p.name.replace(/\.md$/, "");
    setChunks((cs) => [
      ...cs,
      {
        promptPath: p.path,
        promptName: p.name,
        sessionName: slug,
        branch: `feat/${slug}`,
        machineId: initialMachines[0]?.id ?? "",
        model: "sonnet",
      },
    ]);
  }

  function updateChunk(path: string, patch: Partial<ChunkDraft>) {
    setChunks((cs) => cs.map((c) => (c.promptPath === path ? { ...c, ...patch } : c)));
  }

  async function toggleExpand(path: string) {
    setOpenPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
    if (contentCache[path] !== undefined || !projectId) return;
    const res = await fetchOrRedirectToLogin(
      `/api/compose/prompts/content?project_id=${projectId}&path=${encodeURIComponent(path)}`,
      () => router.push("/login"),
      { cache: "no-store" },
    );
    if (!res) return;
    const body = await res.json().catch(() => null);
    const text =
      body && body.configured && typeof body.content === "string"
        ? body.content
        : body && !body.configured
          ? "(GitHub token not configured — full content unavailable)"
          : `(failed to load: ${body?.error ?? res.status})`;
    setContentCache((prev) => ({ ...prev, [path]: text }));
  }

  const canPreview =
    isValidWaveName(waveName) &&
    chunks.length > 0 &&
    chunks.every((c) => chunkIssues(c).length === 0);

  async function saveDraft() {
    setSaving(true);
    setSaveError(null);
    const res = await fetchOrRedirectToLogin(
      "/api/compose/draft",
      () => router.push("/login"),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          wave_name: waveName,
          notes: notes.trim() || null,
          chunks: chunks.map((c) => ({
            session_name: c.sessionName,
            branch: c.branch,
            machine_id: c.machineId,
            model: c.model,
            prompt_ref: c.promptPath,
          })),
        }),
      },
    );
    if (!res) {
      setSaving(false);
      return;
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setSaveError(body.error ?? `Request failed (${res.status})`);
      setSaving(false);
      return;
    }
    const body = (await res.json()) as { wave_id: string };
    setDraft({ waveId: body.wave_id, waveName });
    setConfirmTyped("");
    setStep("confirm");
    setSaving(false);
  }

  async function confirmWave() {
    if (!draft) return;
    setConfirming(true);
    setConfirmError(null);
    const res = await fetchOrRedirectToLogin(
      `/api/compose/${draft.waveId}/confirm`,
      () => router.push("/login"),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm_name: confirmTyped }),
      },
    );
    if (!res) {
      setConfirming(false);
      return;
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setConfirmError(body.error ?? `Request failed (${res.status})`);
      setConfirming(false);
      return;
    }
    router.push("/waves");
  }

  async function abandonDraft() {
    if (!draft) return;
    setAbandoning(true);
    const res = await fetchOrRedirectToLogin(
      `/api/compose/${draft.waveId}/abandon`,
      () => router.push("/login"),
      { method: "POST" },
    );
    setAbandoning(false);
    if (res?.ok) router.push("/waves");
  }

  return (
    <div className="mt-6 space-y-6">
      {step === "project" && (
        <section>
          <h2 className="text-sm font-semibold text-zinc-200">1. Pick a project</h2>
          {initialProjects.length === 0 ? (
            <p className="mt-2 text-sm text-zinc-500">No active projects.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {initialProjects.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => selectProject(p)}
                    className="w-full rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3 text-left hover:bg-white/[0.05]"
                  >
                    <span className="font-mono text-sm text-zinc-100">{p.name}</span>
                    <span className="ml-2 text-xs text-zinc-500">{p.repo}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {step === "chunks" && (
        <section className="space-y-4">
          <button
            type="button"
            onClick={() => setStep("project")}
            className="text-xs text-zinc-400 underline underline-offset-2"
          >
            ← change project
          </button>
          <h2 className="text-sm font-semibold text-zinc-200">
            2. Wave — <span className="font-mono text-zinc-100">{project?.name}</span>
          </h2>

          <div className="space-y-2">
            <label className="block text-xs text-zinc-400">
              Wave name
              <input
                value={waveName}
                onChange={(e) => setWaveName(e.target.value)}
                placeholder="mcv2-w3-selftest"
                className="mt-1 w-full rounded-lg border border-white/10 bg-white/[0.03] p-2 font-mono text-sm text-zinc-100 outline-none focus:border-indigo-400/50"
              />
            </label>
            <label className="block text-xs text-zinc-400">
              Notes (optional)
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="mt-1 w-full rounded-lg border border-white/10 bg-white/[0.03] p-2 text-sm text-zinc-100 outline-none focus:border-indigo-400/50"
              />
            </label>
          </div>

          <div>
            <h3 className="text-xs font-semibold text-zinc-300">Committed prompts</h3>
            {promptsLoading && <p className="mt-2 text-xs text-zinc-500">Loading…</p>}
            {!promptsLoading && !promptsConfigured && (
              <p className="mt-2 text-xs text-amber-400">
                read-only: GitHub token not configured
              </p>
            )}
            {!promptsLoading && promptsConfigured && promptsError && (
              <p className="mt-2 text-xs text-rose-400">{promptsError}</p>
            )}
            {!promptsLoading && promptsConfigured && !promptsError && prompts.length === 0 && (
              <p className="mt-2 text-xs text-zinc-500">
                No ops/prompts/PROMPT_*.md files found on {project?.default_branch}.
              </p>
            )}
            {!promptsLoading && promptsConfigured && prompts.length > 0 && (
              <ul className="mt-2 space-y-1">
                {prompts.map((p) => {
                  const checked = chunks.some((c) => c.promptPath === p.path);
                  return (
                    <li key={p.path}>
                      <label className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-zinc-200 hover:bg-white/[0.03]">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => togglePrompt(p)}
                        />
                        <span className="font-mono text-xs">{p.name}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {chunks.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-xs font-semibold text-zinc-300">Per-chunk settings</h3>
              {chunks.map((c) => {
                const issues = chunkIssues(c);
                return (
                  <div
                    key={c.promptPath}
                    className="space-y-2 rounded-xl border border-white/10 bg-white/[0.02] p-3"
                  >
                    <p className="font-mono text-xs text-zinc-400">{c.promptName}</p>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="text-xs text-zinc-400">
                        Session name
                        <input
                          value={c.sessionName}
                          onChange={(e) =>
                            updateChunk(c.promptPath, { sessionName: e.target.value })
                          }
                          className="mt-1 w-full rounded-lg border border-white/10 bg-white/[0.03] p-1.5 font-mono text-xs text-zinc-100 outline-none focus:border-indigo-400/50"
                        />
                      </label>
                      <label className="text-xs text-zinc-400">
                        Branch
                        <input
                          value={c.branch}
                          onChange={(e) =>
                            updateChunk(c.promptPath, { branch: e.target.value })
                          }
                          className="mt-1 w-full rounded-lg border border-white/10 bg-white/[0.03] p-1.5 font-mono text-xs text-zinc-100 outline-none focus:border-indigo-400/50"
                        />
                      </label>
                      <label className="text-xs text-zinc-400">
                        Machine
                        <select
                          value={c.machineId}
                          onChange={(e) =>
                            updateChunk(c.promptPath, { machineId: e.target.value })
                          }
                          className="mt-1 w-full rounded-lg border border-white/10 bg-white/[0.03] p-1.5 text-xs text-zinc-100 outline-none focus:border-indigo-400/50"
                        >
                          <option value="">— select —</option>
                          {initialMachines.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="text-xs text-zinc-400">
                        Model
                        <select
                          value={c.model}
                          onChange={(e) =>
                            updateChunk(c.promptPath, { model: e.target.value as Model })
                          }
                          className="mt-1 w-full rounded-lg border border-white/10 bg-white/[0.03] p-1.5 text-xs text-zinc-100 outline-none focus:border-indigo-400/50"
                        >
                          {MODELS.map((m) => (
                            <option key={m} value={m}>
                              {m}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    {issues.length > 0 && (
                      <p className="text-xs text-rose-400">{issues.join(", ")}</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <button
            type="button"
            disabled={!canPreview}
            onClick={() => setStep("preview")}
            className="min-h-9 rounded-lg bg-indigo-500 px-4 text-sm font-medium text-white disabled:opacity-40"
          >
            Preview
          </button>
        </section>
      )}

      {step === "preview" && (
        <section className="space-y-4">
          <button
            type="button"
            onClick={() => setStep("chunks")}
            className="text-xs text-zinc-400 underline underline-offset-2"
          >
            ← back to edit
          </button>
          <h2 className="text-sm font-semibold text-zinc-200">
            3. Preview — <span className="font-mono text-zinc-100">{waveName}</span>
          </h2>
          <p className="text-xs text-zinc-500">
            {project?.name} · {chunks.length} chunk{chunks.length === 1 ? "" : "s"}
          </p>

          <div className="space-y-3">
            {chunks.map((c) => (
              <div
                key={c.promptPath}
                className="space-y-2 rounded-xl border border-white/10 bg-white/[0.02] p-3"
              >
                <p className="font-mono text-xs text-zinc-100">
                  {c.sessionName} <span className="text-zinc-500">· {c.branch}</span>
                </p>
                <p className="text-xs text-zinc-500">
                  {machineName(c.machineId)} · {c.model}
                </p>
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-zinc-500">
                    Composed by the agent from validated fields
                  </p>
                  <p className="mt-1 whitespace-pre-wrap rounded-lg bg-black/30 p-2 font-mono text-xs text-zinc-300">
                    {composeDirective({ promptRef: c.promptPath, branch: c.branch })}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => toggleExpand(c.promptPath)}
                  className="text-xs text-indigo-300 underline underline-offset-2"
                >
                  {openPaths.has(c.promptPath) ? "hide" : "show"} full prompt ({c.promptPath})
                </button>
                {openPaths.has(c.promptPath) && (
                  <p className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg bg-black/30 p-2 font-mono text-xs text-zinc-400">
                    {contentCache[c.promptPath] ?? "Loading…"}
                  </p>
                )}
              </div>
            ))}
          </div>

          {saveError && <p className="text-xs text-rose-400">{saveError}</p>}
          <button
            type="button"
            disabled={saving}
            onClick={saveDraft}
            className="min-h-9 rounded-lg bg-indigo-500 px-4 text-sm font-medium text-white disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save draft"}
          </button>
        </section>
      )}

      {step === "confirm" && draft && (
        <section className="space-y-4">
          <h2 className="text-sm font-semibold text-zinc-200">4. Confirm</h2>
          <p className="text-xs text-zinc-500">
            This is the execution trigger — nothing launches until you confirm.
          </p>
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
            <p className="font-mono text-sm text-zinc-100">{draft.waveName}</p>
            <p className="mt-1 text-xs text-zinc-500">{project?.name}</p>
            <ul className="mt-2 space-y-1">
              {chunks.map((c) => (
                <li key={c.promptPath} className="font-mono text-xs text-zinc-400">
                  {c.sessionName} · {c.branch} · {machineName(c.machineId)} · {c.model}
                </li>
              ))}
            </ul>
          </div>

          <label className="block text-xs text-zinc-400">
            Type the wave name (<span className="font-mono">{draft.waveName}</span>) to arm
            Confirm
            <input
              value={confirmTyped}
              onChange={(e) => setConfirmTyped(e.target.value)}
              className="mt-1 w-full rounded-lg border border-white/10 bg-white/[0.03] p-2 font-mono text-sm text-zinc-100 outline-none focus:border-indigo-400/50"
            />
          </label>

          {confirmError && <p className="text-xs text-rose-400">{confirmError}</p>}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!isArmed(confirmTyped, draft.waveName) || confirming}
              onClick={confirmWave}
              className="min-h-9 rounded-lg bg-emerald-500 px-4 text-sm font-medium text-zinc-950 disabled:opacity-40"
            >
              {confirming ? "Confirming…" : "Confirm"}
            </button>
            <button
              type="button"
              disabled={abandoning}
              onClick={abandonDraft}
              className="min-h-9 rounded-lg border border-white/10 bg-white/[0.03] px-4 text-sm text-zinc-300 disabled:opacity-50"
            >
              {abandoning ? "Abandoning…" : "Abandon draft"}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
