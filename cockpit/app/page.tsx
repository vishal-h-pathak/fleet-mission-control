import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "./sign-out-button";

// Authed content, reads the per-request session cookie — never static.
export const dynamic = "force-dynamic";

// Authed landing page. Reaching this point means middleware.ts already
// confirmed a valid session AND an allowlisted email — no further auth check
// needed here. Task 2 replaces the body content (the session inbox); it does
// not touch the auth wrapper.
export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col px-6 py-8">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-zinc-50">MCv2 Cockpit</h1>
        <SignOutButton />
      </header>
      <div className="mt-10 rounded-2xl border border-white/10 bg-white/[0.02] px-5 py-6">
        <p className="text-sm text-zinc-400">
          Signed in as <span className="text-zinc-200">{user?.email}</span>
        </p>
        <p className="mt-3 text-zinc-300">Inbox coming next.</p>
      </div>
    </main>
  );
}
