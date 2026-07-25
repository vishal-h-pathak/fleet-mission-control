import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// SERVICE-ROLE client — SERVER ONLY. Bypasses RLS.
//
// DO NOT import this file from any "use client" module or from
// proxy.ts (the edge proxy runtime should never hold this key — it only
// needs the anon-key session client in lib/supabase/server.ts). Import it
// ONLY from Server Components or Route Handlers that explicitly need
// privileged reads/writes (Task 2's fleet_projects/waves/sessions/decisions
// queries, decision-writing mutations, etc).
//
// The `server-only` import above makes the build FAIL if this module is
// ever pulled into client code, so the service-role key can never reach the
// browser bundle.
export function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (server-only)",
    );
  }
  return createSupabaseClient(url, serviceKey, {
    auth: { persistSession: false },
  });
}
