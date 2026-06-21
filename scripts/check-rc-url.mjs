// /rc URL detection self-test. Asserts the reporter's log scraper (extractRcUrl)
// and the --set-rc validator (validateRcUrl) accept the real Remote Control link
// shapes and reject adversarial near-misses, so a noisy job log can't inject a
// bogus rc_url. Zero-dep; mirrors scripts/check-allowlist-parity.mjs.
//
//   node scripts/check-rc-url.mjs
import { extractRcUrl, validateRcUrl } from "../rc.mjs";

let fails = 0;
const ok = (cond, label) => {
  console.log(`${cond ? "ok  " : "FAIL"}  ${label}`);
  if (!cond) fails++;
};

// ── extractRcUrl: full URL expected back, or null ──────────────────────────
const EXTRACT = [
  // [log line, expected extracted url | null]
  ["Remote control: https://app.claude.com/rc/graceful-unicorn-7f3a", "https://app.claude.com/rc/graceful-unicorn-7f3a"],
  ["Open this session: https://claude.ai/code/session/abc123DEF", "https://claude.ai/code/session/abc123DEF"],
  ["session at https://claude.com/code/xy-99_z", "https://claude.com/code/xy-99_z"],
  ["url with query https://app.claude.com/rc/abc?token=zz-1", "https://app.claude.com/rc/abc?token=zz-1"],
  ["wrapped (https://app.claude.com/rc/abc123).", "https://app.claude.com/rc/abc123"], // trailing )/. stripped
  // adversarial — must NOT match (null)
  ["bare host https://app.claude.com/rc no id", null],
  ["bare interface https://claude.ai/code right here", null],
  ["wrong path https://claude.ai/chat/abc123", null],
  ["not tls http://app.claude.com/rc/abc123", null],
  ["arbitrary https://claude.com/pricing/teams", null],
  ["unrelated https://github.com/foo/bar/rc/baz", null],
  ["no url at all, gen 12 best=0.81", null],
];
for (const [line, want] of EXTRACT) {
  const got = extractRcUrl(line);
  ok(got === want, `extract  ${JSON.stringify(want)} ⟵ ${JSON.stringify(line)}  (got ${JSON.stringify(got)})`);
}

// LAST match wins when a session runs /rc more than once.
const multi = [
  "first https://app.claude.com/rc/old-session-1",
  "...later...",
  "reconnected https://app.claude.com/rc/new-session-2",
].join("\n");
ok(extractRcUrl(multi) === "https://app.claude.com/rc/new-session-2", "extract  last /rc match wins");
ok(extractRcUrl("") === null && extractRcUrl(undefined) === null, "extract  empty/undefined → null");

// ── validateRcUrl (--set-rc): https on a Claude host ───────────────────────
const VALIDATE = [
  ["https://app.claude.com/rc/abc123", true],
  ["https://claude.ai/code/session/abc", true],
  ["https://claude.com/code/x", true],
  ["  https://app.claude.com/rc/abc  ", true],  // trimmed
  ["http://app.claude.com/rc/abc", false],       // not https
  ["https://evil.com/rc/abc", false],            // wrong host
  ["https://app.claude.com.evil.com/rc/x", false], // host suffix attack
  ["ftp://claude.ai/code/x", false],
  ["not a url", false],
  ["", false],
  [null, false],
];
for (const [url, want] of VALIDATE) {
  ok(validateRcUrl(url) === want, `validate ${want} ⟵ ${JSON.stringify(url)}`);
}

console.log(`\n${fails === 0 ? "RC URL OK" : `RC URL FAIL — ${fails} failure(s)`}`);
process.exit(fails === 0 ? 0 : 1);
