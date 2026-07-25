import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseEnv } from "@/lib/supabase/env";

// Server-side ANON-key client bound to the request's cookies, for Server
// Components and Route Handlers that need to read the signed-in user's own
// session (e.g. the /auth/callback code exchange, or a page reading the
// current user). Same privilege as the browser client — no secrets here.
// This is NOT the service-role admin client; see lib/supabase/admin.ts for
// privileged reads/writes.
export async function createClient() {
  const { url, anonKey } = getSupabaseEnv();

  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component render — cookies() is read-only
          // there. Safe to ignore because proxy.ts refreshes the
          // session cookie on every navigation anyway.
        }
      },
    },
  });
}
