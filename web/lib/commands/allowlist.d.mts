// Types for the shared, framework-free allowlist.mjs so the TypeScript dispatch
// route gets full typing while the runtime file stays plain ESM (importable by
// the Node agent). Keep in sync with allowlist.mjs.

export type ArgKind = "name" | "relpath" | "repo" | "directive";

export interface ArgSpec {
  name: string;
  required: boolean;
  kind: ArgKind;
  /** For kind "repo": the closed set of allowed values (drives the UI dropdown). */
  options?: string[];
  /** For kind "directive": max length (drives the UI character counter). */
  maxLen?: number;
}

export interface VerbSpec {
  /** Powerful verbs land as 'awaiting_approval' and need a second authed Approve. */
  requiresApproval: boolean;
  args: ArgSpec[];
}

export declare const VERBS: Record<string, VerbSpec>;

export declare const ALLOWED_VERBS: string[];

/** The closed set of repos accepted by the `run` verb. */
export declare const RUN_REPOS: string[];

export declare function isAllowedVerb(verb: unknown): boolean;

/** True iff the verb is allowlisted AND flagged as approval-required. */
export declare function requiresApproval(verb: unknown): boolean;

export type ValidateResult =
  | { ok: true; verb: string; args: Record<string, string> }
  | { ok: false; error: string };

export declare function validateCommand(
  verb: unknown,
  rawArgs: unknown,
): ValidateResult;
