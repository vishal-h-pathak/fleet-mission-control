// Types for the shared, framework-free allowlist.mjs so the TypeScript dispatch
// route gets full typing while the runtime file stays plain ESM (importable by
// the Node agent). Keep in sync with allowlist.mjs.

export interface ArgSpec {
  name: string;
  required: boolean;
  kind: "name" | "relpath" | "repo" | "directive";
}

export interface VerbSpec {
  requiresApproval: boolean;
  args: ArgSpec[];
}

export declare const VERBS: Record<string, VerbSpec>;

export declare const ALLOWED_VERBS: string[];

export declare const RUN_REPOS: string[];

export declare function isAllowedVerb(verb: unknown): boolean;

export declare function verbRequiresApproval(verb: unknown): boolean;

export type ValidateResult =
  | { ok: true; verb: string; args: Record<string, string> }
  | { ok: false; error: string };

export declare function validateCommand(
  verb: unknown,
  rawArgs: unknown,
): ValidateResult;
