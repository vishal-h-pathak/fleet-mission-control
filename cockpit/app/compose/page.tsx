// cockpit/app/compose/page.tsx
import { getActiveProjects, getMachines } from "@/lib/projects/data";
import { ComposeView } from "./compose-view";
import { CockpitNav } from "../nav";
import { SignOutButton } from "../sign-out-button";

export const dynamic = "force-dynamic";

// Authed landing for Compose. Reaching this point means proxy.ts already
// confirmed a valid session + allowlisted email. Fetches the project +
// machine pickers' options server-side (admin client, no HTTP round-trip)
// so the wizard opens with real data — same split as app/page.tsx /
// app/waves/page.tsx.
export default async function ComposePage() {
  const [projects, machines] = await Promise.all([
    getActiveProjects(),
    getMachines(),
  ]);

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col px-6 py-8">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-zinc-50">Compose</h1>
        <SignOutButton />
      </header>
      <CockpitNav active="compose" />
      <ComposeView initialProjects={projects} initialMachines={machines} />
    </main>
  );
}
