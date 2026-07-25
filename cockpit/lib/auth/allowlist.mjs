// Plain ESM, zero deps — mirrors the web/lib/commands/allowlist.mjs pattern
// (single source of truth, importable both by TypeScript via the sibling
// .d.mts and by a standalone Node self-test with no build step).
//
// Parses COCKPIT_ALLOWED_EMAILS ("a@x.com, b@y.com") and answers whether a
// given signed-in email is a member. Comma-separated, trimmed,
// case-insensitive, exact-match only (no substring/suffix matching) — fails
// closed (rejects) on any missing/empty input.

/** @param {string | null | undefined} csv */
function parseAllowlist(csv) {
  if (!csv) return [];
  return csv
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);
}

/**
 * @param {string | null | undefined} email
 * @param {string | null | undefined} allowedEmailsCsv
 * @returns {boolean}
 */
export function isAllowedEmail(email, allowedEmailsCsv) {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;
  const allowed = parseAllowlist(allowedEmailsCsv);
  return allowed.includes(normalized);
}
