// Self-contained, dependency-free auth cookie: an HMAC-SHA256-signed token.
// Uses the Web Crypto API so the SAME code runs in edge middleware AND node
// route handlers. The shared password is exchanged for this signed cookie; the
// cookie carries no secret, only a signed assertion that the password was valid.

export const COOKIE_NAME = "fleet_auth";
const SESSION_TTL_S = 60 * 60 * 24 * 7; // 7 days

function getSecret(): string {
  const secret = process.env.FLEET_AUTH_SECRET;
  if (!secret) throw new Error("Missing FLEET_AUTH_SECRET");
  return secret;
}

function b64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmac(payload: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(getSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload),
  );
  return new Uint8Array(sig);
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Mint a signed session token (cookie value). */
export async function createSessionToken(): Promise<string> {
  const nowS = Math.floor(Date.now() / 1000);
  const payload = JSON.stringify({ v: 1, iat: nowS, exp: nowS + SESSION_TTL_S });
  const payloadB64 = b64urlEncode(new TextEncoder().encode(payload));
  const sigB64 = b64urlEncode(await hmac(payloadB64));
  return `${payloadB64}.${sigB64}`;
}

/** Validate a session token: signature intact AND not expired. */
export async function verifySessionToken(
  token: string | undefined | null,
): Promise<boolean> {
  if (!token) return false;
  const [payloadB64, sigB64] = token.split(".");
  if (!payloadB64 || !sigB64) return false;
  let expected: Uint8Array;
  let got: Uint8Array;
  try {
    expected = await hmac(payloadB64);
    got = b64urlDecode(sigB64);
  } catch {
    return false;
  }
  if (!timingSafeEqual(expected, got)) return false;
  try {
    const payload = JSON.parse(
      new TextDecoder().decode(b64urlDecode(payloadB64)),
    ) as { exp?: number };
    if (!payload.exp || Math.floor(Date.now() / 1000) > payload.exp) return false;
  } catch {
    return false;
  }
  return true;
}

export const SESSION_MAX_AGE = SESSION_TTL_S;
