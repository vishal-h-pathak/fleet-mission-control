// Types for the framework-free allowlist.mjs so middleware.ts gets full typing
// while the runtime file stays plain ESM (importable by the Node self-test
// with no build step). Keep in sync with allowlist.mjs.

/**
 * True iff `email` (trimmed, case-insensitive) is one of the comma-separated
 * entries in `allowedEmailsCsv` (each entry also trimmed, case-insensitive).
 * Exact match only — no substring/suffix matching. Fails closed: any
 * missing/empty email or allowlist input returns false.
 */
export declare function isAllowedEmail(
  email: string | null | undefined,
  allowedEmailsCsv: string | null | undefined,
): boolean;
