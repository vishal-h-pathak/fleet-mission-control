// Plain ESM, zero deps — mirrors lib/inbox/decisions-core.mjs's pattern.
//
// Composes the fixed directive template a launched agent will paste
// unsubmitted into the Code session it starts. Parameterized ONLY by
// `prompt_ref` and `branch` — both already charset-validated (see
// validate.mjs) before this is called. This is not the directive the agent
// will actually execute (agent/ is out of this wave's scope and recomputes
// its own copy independently per ops/prompts/PROMPT_mcv2_agent_runwave.md);
// it is what the Compose preview screen shows the operator ("composed by the
// agent from validated fields") and what gets stored on `fleet_sessions.
// directive` for record-only audit — never transported to an agent
// (docs/SCHEMA_V2.md security invariant (c)).
//
// Template source of record: ops/prompts/PROMPT_mcv2_agent_runwave.md's
// "Launch" section, verbatim except for the two parameters.

/**
 * @param {{ promptRef: string, branch: string }} fields
 * @returns {string}
 */
export function composeDirective({ promptRef, branch }) {
  return (
    `Read ./ops/prompts/PROMPT_fleet_conventions.md then ./${promptRef} and ` +
    `implement it on this branch (${branch}). Validate, then STOP and ` +
    `report. Do not begin until the operator confirms.`
  );
}
