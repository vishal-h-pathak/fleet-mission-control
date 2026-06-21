import "server-only";

import { createClient } from "@supabase/supabase-js";

// SERVICE-ROLE client — SERVER ONLY. Bypasses RLS; reads the private
// fleet_job_links / fleet_machine_secrets tables. The `server-only` import above
// makes the build FAIL if this module is ever pulled into client code, so the
// service-role key can never reach the browser.
export function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (server-only)",
    );
  }
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}
