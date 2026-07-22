"use client";

import { createBrowserClient } from "@supabase/ssr";

// Browser client — ANON key ONLY. Used ONLY for the auth flow
// (signInWithOtp / session handling) from client components (/login,
// sign-out). It stores the session in cookies (via @supabase/ssr) so
// middleware.ts and server components can read the same session — never in
// localStorage. It must never see the service-role key; see lib/supabase/admin.ts
// for that.
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY",
    );
  }
  return createBrowserClient(url, anonKey);
}
