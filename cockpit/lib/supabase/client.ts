"use client";

import { createBrowserClient } from "@supabase/ssr";
import { getSupabaseEnv } from "@/lib/supabase/env";

// Browser client — ANON key ONLY. Used ONLY for the auth flow
// (signInWithOtp / session handling) from client components (/login,
// sign-out). It stores the session in cookies (via @supabase/ssr) so
// proxy.ts and server components can read the same session — never in
// localStorage. It must never see the service-role key; see lib/supabase/admin.ts
// for that.
export function createClient() {
  const { url, anonKey } = getSupabaseEnv();
  return createBrowserClient(url, anonKey);
}
