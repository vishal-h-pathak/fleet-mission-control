"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Browser client — PUBLIC, read-only by RLS. Uses ONLY the anon/publishable key.
// It can never read fleet_job_links / fleet_machine_secrets (deny-all RLS).
let cached: SupabaseClient | null = null;

export function getBrowserClient(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY",
    );
  }
  cached = createClient(url, anonKey, {
    auth: { persistSession: false },
  });
  return cached;
}
