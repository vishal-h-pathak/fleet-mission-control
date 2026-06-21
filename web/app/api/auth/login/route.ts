import { NextResponse, type NextRequest } from "next/server";
import { COOKIE_NAME, SESSION_MAX_AGE, createSessionToken } from "@/lib/auth";

export const runtime = "nodejs";

function safeEqual(a: string, b: string): boolean {
  const ab = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

export async function POST(req: NextRequest) {
  const expected = process.env.FLEET_DASH_PASSWORD;
  if (!expected) {
    return NextResponse.json(
      { error: "server_misconfigured", message: "FLEET_DASH_PASSWORD not set." },
      { status: 500 },
    );
  }

  let password = "";
  try {
    const body = await req.json();
    password = typeof body?.password === "string" ? body.password : "";
  } catch {
    // fall through to invalid
  }

  if (!password || !safeEqual(password, expected)) {
    return NextResponse.json(
      { error: "invalid_password" },
      { status: 401 },
    );
  }

  const token = await createSessionToken();
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return res;
}
