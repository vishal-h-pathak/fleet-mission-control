// Types for the framework-free validate.mjs so TypeScript callers (the API
// routes, the Compose UI) get full typing while the runtime file stays plain
// ESM (importable by the Node self-test with no build step). Keep in sync
// with validate.mjs.

export declare const NAME_RE: RegExp;
export declare const PROMPT_REF_RE: RegExp;
export declare const MODELS: readonly ["haiku", "sonnet", "opus"];
export declare const WAVE_NAME_MAX: number;
export declare const MAX_CHUNKS: number;

export declare function isValidSessionName(name: unknown): name is string;
export declare function isValidBranch(branch: unknown): branch is string;
export declare function isValidPromptRef(promptRef: unknown): promptRef is string;
export declare function isValidModel(
  model: unknown,
): model is "haiku" | "sonnet" | "opus";
export declare function isValidWaveName(name: unknown): name is string;
export declare function promptSlug(filename: string): string | null;
export declare function isArmed(typed: unknown, waveName: string): boolean;
