import { createClient } from "@supabase/supabase-js";

// Server-side ANON client for SSR of the public plane (initial machine/job data).
// Read-only by RLS; identical privilege to the browser client — no secrets here.
export function getAnonServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY",
    );
  }
  return createClient(url, anonKey, { auth: { persistSession: false } });
}
