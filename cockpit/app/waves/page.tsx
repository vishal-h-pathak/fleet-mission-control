// cockpit/app/waves/page.tsx
import { getMachineRail, getWavesBoard } from "@/lib/waves/data";
import { WavesView } from "./waves-view";
import { CockpitNav } from "../nav";
import { SignOutButton } from "../sign-out-button";

export const dynamic = "force-dynamic";

// Authed landing for the Waves board. Reaching this point means proxy.ts
// already confirmed a valid session + allowlisted email. Fetches the initial
// board + machine rail server-side (admin client, no HTTP round-trip) so the
// first paint has real data; WavesView takes over polling (/api/waves) from
// there — same split as app/page.tsx / InboxView.
export default async function WavesPage() {
  const [initialProjects, initialMachines] = await Promise.all([
    getWavesBoard(),
    getMachineRail(),
  ]);

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col px-6 py-8">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-zinc-50">Waves</h1>
        <SignOutButton />
      </header>
      <CockpitNav active="waves" />
      <WavesView
        initialProjects={initialProjects}
        initialMachines={initialMachines}
      />
    </main>
  );
}
