import "server-only";

import { getAdminClient } from "@/lib/supabase/admin";

// Server-only Compose data layer: the project + machine pickers. Uses the
// service-role admin client — fleet_projects/fleet_machines are read here the
// same way lib/waves/data.ts and lib/inbox/data.ts read their tables (one
// consistent server-only privilege model across the cockpit).

export interface ComposeProject {
  id: string;
  name: string;
  repo: string;
  default_branch: string;
}

export interface ComposeMachine {
  id: string;
  name: string;
}

/** Active `fleet_projects` rows — the picker's project list. Per
 * ops/prompts/PROMPT_mcv2_compose.md §1, the repo set is never hard-coded in
 * the cockpit; it always comes from this table. */
export async function getActiveProjects(): Promise<ComposeProject[]> {
  const supabase = getAdminClient();

  const { data, error } = await supabase
    .from("fleet_projects")
    .select("id, name, repo, default_branch")
    .eq("active", true)
    .order("name")
    .returns<ComposeProject[]>();

  if (error) {
    throw new Error(`fleet_projects query failed: ${error.message}`);
  }

  return data ?? [];
}

/** All `fleet_machines` — the per-chunk machine picker. */
export async function getMachines(): Promise<ComposeMachine[]> {
  const supabase = getAdminClient();

  const { data, error } = await supabase
    .from("fleet_machines")
    .select("id, name")
    .order("name")
    .returns<ComposeMachine[]>();

  if (error) {
    throw new Error(`fleet_machines query failed: ${error.message}`);
  }

  return data ?? [];
}
