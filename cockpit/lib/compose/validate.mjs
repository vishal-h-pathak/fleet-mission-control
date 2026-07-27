// Plain ESM, zero deps — mirrors lib/auth/allowlist.mjs / lib/inbox/decisions-core.mjs.
//
// Pure validation shared by the Compose API routes (app/api/compose/**). Charsets
// mirror the ones already enforced ingest-side (supabase/functions/ingest/session-
// logic.mjs's NAME_RE) and agent-side (ops/prompts/PROMPT_mcv2_agent_runwave.md's
// validation gauntlet, item 2: prompt_ref must match
// `^ops/prompts/PROMPT_[A-Za-z0-9_.-]{1,120}\.md$`) — reused, not re-invented, so a
// compose-built session row can never carry a shape the ingest register path or the
// (future) agent would itself reject.

// Session/branch/project-name charset — identical to ingest's NAME_RE.
export const NAME_RE = /^[A-Za-z0-9._/-]{1,200}$/;

// A committed-prompt reference, as it will be re-validated agent-side.
export const PROMPT_REF_RE = /^ops\/prompts\/PROMPT_[A-Za-z0-9_.-]{1,120}\.md$/;

export const MODELS = Object.freeze(["haiku", "sonnet", "opus"]);

export const WAVE_NAME_MAX = 200;
export const MAX_CHUNKS = 100;

/** @param {string} name */
export function isValidSessionName(name) {
  return typeof name === "string" && NAME_RE.test(name);
}

/** @param {string} branch */
export function isValidBranch(branch) {
  return typeof branch === "string" && NAME_RE.test(branch);
}

/** @param {string} promptRef */
export function isValidPromptRef(promptRef) {
  return typeof promptRef === "string" && PROMPT_REF_RE.test(promptRef);
}

/** @param {string} model */
export function isValidModel(model) {
  return typeof model === "string" && MODELS.includes(model);
}

/** @param {string} name */
export function isValidWaveName(name) {
  return (
    typeof name === "string" &&
    name.trim().length > 0 &&
    name.length <= WAVE_NAME_MAX
  );
}

/**
 * Derives the default session-name/branch slug from a prompt filename, e.g.
 * `PROMPT_mcv2_compose.md` -> `mcv2-compose` — underscores to hyphens, so the
 * default matches this repo's actual branch-naming convention (`feat/mcv2-
 * compose`, not `feat/mcv2_compose`) even though prompt filenames use
 * underscores.
 *
 * @param {string} filename
 * @returns {string | null} null if filename doesn't look like a prompt file.
 */
export function promptSlug(filename) {
  const m = /^PROMPT_(.+)\.md$/.exec(filename);
  if (!m) return null;
  return m[1].replace(/_/g, "-");
}

/**
 * The Confirm screen's "type the wave name to arm" gate. Exact match, no
 * trimming/casing leniency — the operator must type the wave name precisely,
 * on purpose, to arm an execution trigger.
 *
 * @param {string} typed
 * @param {string} waveName
 */
export function isArmed(typed, waveName) {
  return typeof typed === "string" && typed === waveName;
}
