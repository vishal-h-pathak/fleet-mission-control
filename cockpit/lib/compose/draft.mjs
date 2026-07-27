// Plain ESM, zero deps — mirrors lib/inbox/decisions-core.mjs / lib/waves/group.mjs.
//
// Pure logic for POST /api/compose/draft: validates the wizard's request body and
// shapes the fleet_waves / fleet_sessions insert rows. Deliberately zero I/O (no
// Supabase, no fetch) so it's unit-testable against fixtures — the route layer
// (app/api/compose/draft/route.ts) does the DB existence checks (project_id,
// machine_id) and the actual inserts.
//
// Row shapes deliberately differ from the ingest `register` block's semantics
// (supabase/functions/ingest/index.ts's handleRegister), because Compose is a
// different actor: an authed operator composing work in the cockpit UI, not a
// machine's launcher recording a dispatch that already happened.
//   - `registered_by` (which machine POSTed the register block) stays null — no
//     machine is involved yet.
//   - `dispatched_at` (wave AND session) stays null — nothing has launched. The
//     register path stamps it at registration time because for that path,
//     registration IS the dispatch; here dispatch is a separate, later event (the
//     `dispatch` Edge Function's ack), which never stamps it either (checked: it
//     only ever writes claimed_at/claimed_by/launched_at/launch_error/status).
//   - `worktree` stays null — per ops/prompts/PROMPT_mcv2_agent_runwave.md, the
//     worktree path is COMPUTED BY THE AGENT and any registered value is ignored
//     for execution, so recording one here would be misleading, not just useless.

import { composeDirective } from "./directive.mjs";
import {
  MAX_CHUNKS,
  isValidBranch,
  isValidModel,
  isValidPromptRef,
  isValidSessionName,
  isValidWaveName,
} from "./validate.mjs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(v) {
  return typeof v === "string" && UUID_RE.test(v);
}

/**
 * Validates and normalizes a draft-compose request body. Pure — does not
 * check that project_id/machine_id actually exist (the route does that
 * against the DB before writing anything, same "validate everything before
 * any write" discipline as ingest's handleRegister).
 *
 * @param {unknown} body
 * @returns {import('./draft.d.mts').ValidateDraftResult}
 */
export function validateDraftPayload(body) {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "bad_request" };
  }
  const b = /** @type {any} */ (body);

  if (!isUuid(b.project_id)) return { ok: false, error: "bad_project_id" };
  if (!isValidWaveName(b.wave_name)) return { ok: false, error: "bad_wave_name" };

  const notes =
    b.notes === undefined || b.notes === null
      ? null
      : typeof b.notes === "string"
        ? b.notes
        : undefined;
  if (notes === undefined) return { ok: false, error: "bad_notes" };

  if (!Array.isArray(b.chunks) || b.chunks.length === 0) {
    return { ok: false, error: "no_chunks" };
  }
  if (b.chunks.length > MAX_CHUNKS) return { ok: false, error: "too_many_chunks" };

  const chunks = [];
  for (const c of b.chunks) {
    if (!c || typeof c !== "object") return { ok: false, error: "bad_chunk" };
    const chunk = /** @type {any} */ (c);
    if (!isValidSessionName(chunk.session_name)) {
      return { ok: false, error: "bad_session_name" };
    }
    if (!isValidBranch(chunk.branch)) return { ok: false, error: "bad_branch" };
    if (!isUuid(chunk.machine_id)) return { ok: false, error: "bad_machine_id" };
    if (!isValidModel(chunk.model)) return { ok: false, error: "bad_model" };
    if (!isValidPromptRef(chunk.prompt_ref)) {
      return { ok: false, error: "bad_prompt_ref" };
    }
    chunks.push({
      sessionName: chunk.session_name,
      branch: chunk.branch,
      machineId: chunk.machine_id,
      model: chunk.model,
      promptRef: chunk.prompt_ref,
    });
  }

  return { ok: true, waveName: b.wave_name, notes, chunks };
}

/**
 * @param {{ projectId: string, waveName: string, notes: string | null }} fields
 * @returns {Record<string, unknown>}
 */
export function buildWaveInsertRow({ projectId, waveName, notes }) {
  return {
    project_id: projectId,
    name: waveName,
    status: "draft",
    notes: notes ?? null,
  };
}

/**
 * @param {{
 *   waveId: string,
 *   chunk: { sessionName: string, branch: string, machineId: string, model: string, promptRef: string },
 *   project: string,
 *   repo: string,
 * }} fields
 * @returns {Record<string, unknown>}
 */
export function buildSessionInsertRow({ waveId, chunk, project, repo }) {
  return {
    wave_id: waveId,
    machine_id: chunk.machineId,
    name: chunk.sessionName,
    status: "planned",
    project,
    repo,
    branch: chunk.branch,
    model: chunk.model,
    prompt_ref: chunk.promptRef,
    directive: composeDirective({
      promptRef: chunk.promptRef,
      branch: chunk.branch,
    }),
  };
}
