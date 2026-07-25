import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Completes the Supabase Auth PKCE / magic-link exchange: signInWithOtp
// (see app/login/page.tsx) sends the user an email link that lands here with
// a `code` query param. Exchanging it establishes the session cookie via the
// server client's cookie adapter, then redirects into the authed app.
// middleware.ts runs again on that redirect and does the allowlist check.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
}
