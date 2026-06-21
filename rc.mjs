// Fleet reporter — /remote-control (/rc) URL helpers. Zero-dep, Node 18+, ESM.
// Pure functions so index.mjs and scripts/check-rc-url.mjs can both import them
// without booting the daemon (index.mjs has top-level side effects).
//
// The /rc session surface (Claude Code Remote Control, v2.1.79+, research preview)
// opens a running local session on claude.ai/code. The link it emits is hosted at
// app.claude.com/rc/<session-id> (primary), and the docs also refer to the session
// living at claude.ai/code. We anchor on those hosts + a required trailing
// session-id segment so we don't over-match arbitrary URLs in a noisy job log.
//
// Host-tolerant, PATH-precise:
//   ✓ https://app.claude.com/rc/<id>        (primary — the emitted link)
//   ✓ https://claude.ai/code/<id...>        (the session surface)
//   ✓ https://claude.com/code/<id>
//   ✗ https://app.claude.com/rc             (no session-id segment)
//   ✗ https://claude.ai/code                (bare interface, no session)
//   ✗ https://claude.ai/chat/123            (wrong path)
//   ✗ http://app.claude.com/rc/x            (not TLS)
//   ✗ https://claude.com/anything/else      (arbitrary claude.com URL)
export const RC_URL_RE =
  /\bhttps:\/\/(?:app\.claude\.com\/rc|claude\.ai\/code|claude\.com\/code)\/[A-Za-z0-9][A-Za-z0-9._~%/-]*(?:\?[^\s'"<>]*)?/gi;

// Extract the /rc session URL from a job log buffer. Returns the LAST match
// (most-recent /rc invocation wins if a session ran it more than once), or null.
export function extractRcUrl(buf) {
  if (!buf) return null;
  const matches = buf.match(RC_URL_RE);
  if (!matches || !matches.length) return null;
  // Strip a trailing ) or . or , the URL may have picked up from prose/markdown.
  return matches[matches.length - 1].replace(/[).,]+$/, "");
}

// Validate a URL for the --set-rc helper: must be an https URL on a Claude host.
// More lenient on path than the log scraper (this is an explicit human override),
// but still refuses non-https and non-Claude hosts. Returns true/false.
const RC_HOSTS = new Set(["app.claude.com", "claude.ai", "claude.com"]);
export function validateRcUrl(url) {
  if (typeof url !== "string" || !url) return false;
  let u;
  try {
    u = new URL(url.trim());
  } catch {
    return false;
  }
  return u.protocol === "https:" && RC_HOSTS.has(u.hostname);
}
