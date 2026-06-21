import { cookies } from "next/headers";
import { getAnonServerClient } from "@/lib/supabase/anon-server";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth";
import Dashboard from "@/components/Dashboard";
import type { Job, MachineStatus } from "@/lib/types";

// Always render fresh: the dashboard is a live monitoring plane.
export const dynamic = "force-dynamic";

export default async function Home() {
  const supabase = getAnonServerClient();

  // PUBLIC plane only. We select from public tables/views with the anon key;
  // rc_url and friends live in a deny-all table the anon key cannot read, so
  // they can never enter this server-rendered HTML.
  const [machinesRes, jobsRes] = await Promise.all([
    supabase.from("fleet_machine_status").select("*").order("name"),
    supabase
      .from("fleet_jobs")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(200),
  ]);

  const cookieStore = await cookies();
  const initialAuthed = await verifySessionToken(
    cookieStore.get(COOKIE_NAME)?.value,
  );

  return (
    <Dashboard
      initialMachines={(machinesRes.data as MachineStatus[]) ?? []}
      initialJobs={(jobsRes.data as Job[]) ?? []}
      initialAuthed={initialAuthed}
    />
  );
}
