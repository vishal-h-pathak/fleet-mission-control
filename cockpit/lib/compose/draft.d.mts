// Types for the framework-free draft.mjs. Keep in sync with draft.mjs.

export interface DraftChunk {
  sessionName: string;
  branch: string;
  machineId: string;
  model: "haiku" | "sonnet" | "opus";
  promptRef: string;
}

export type ValidateDraftResult =
  | { ok: true; waveName: string; notes: string | null; chunks: DraftChunk[] }
  | {
      ok: false;
      error:
        | "bad_request"
        | "bad_project_id"
        | "bad_wave_name"
        | "bad_notes"
        | "no_chunks"
        | "too_many_chunks"
        | "bad_chunk"
        | "bad_session_name"
        | "bad_branch"
        | "bad_machine_id"
        | "bad_model"
        | "bad_prompt_ref";
    };

export declare function validateDraftPayload(body: unknown): ValidateDraftResult;

export declare function buildWaveInsertRow(fields: {
  projectId: string;
  waveName: string;
  notes: string | null;
}): Record<string, unknown>;

export declare function buildSessionInsertRow(fields: {
  waveId: string;
  chunk: DraftChunk;
  project: string;
  repo: string;
}): Record<string, unknown>;
