import { createClient } from "@/lib/supabase/server";
import { getInboxGroups } from "@/lib/inbox/data";
import { InboxView } from "./inbox-view";
import { SignOutButton } from "./sign-out-button";
import { CockpitNav } from "./nav";

// Authed content, reads the per-request session cookie — never static.
export const dynamic = "force-dynamic";

// Authed landing page = the Inbox. Reaching this point means proxy.ts
// already confirmed a valid session AND an allowlisted email — no further
// auth check needed here. Fetches the initial three groups server-side
// (admin client, no HTTP round-trip) so the first paint has real data;
// InboxView takes over polling (/api/inbox) from there.
export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const initialGroups = await getInboxGroups();

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col px-6 py-8">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-zinc-50">MCv2 Cockpit</h1>
        <SignOutButton />
      </header>
      <p className="mt-2 text-sm text-zinc-400">
        Signed in as <span className="text-zinc-200">{user?.email}</span>
      </p>
      <CockpitNav active="inbox" />

      <InboxView initialGroups={initialGroups} />
    </main>
  );
}
