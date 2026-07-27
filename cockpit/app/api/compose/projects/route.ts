import { NextResponse } from "next/server";
import { getActiveProjects } from "@/lib/projects/data";

export const dynamic = "force-dynamic";

// Authed via proxy.ts. Step 1 of the Compose wizard: the project picker.
// Never hard-codes the repo set — always reads active fleet_projects rows
// (ops/prompts/PROMPT_mcv2_compose.md §1).
export async function GET() {
  try {
    const projects = await getActiveProjects();
    return NextResponse.json(
      { projects },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    console.error("[api/compose/projects] query failed:", e);
    return NextResponse.json({ error: "projects_query_failed" }, { status: 500 });
  }
}
