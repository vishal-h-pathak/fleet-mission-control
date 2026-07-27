import { NextResponse, type NextRequest } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { listPrompts } from "@/lib/github/prompts";

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Authed via proxy.ts. Step 2 of the Compose wizard: lists
// ops/prompts/PROMPT_*.md committed to the picked project's repo at its
// default branch HEAD (GitHub contents API, read-only token). Returns
// `{ configured: false }` verbatim when COCKPIT_GITHUB_TOKEN isn't set, so
// the UI can render its "read-only: GitHub token not configured" state.
export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("project_id");
  if (!projectId || !UUID_RE.test(projectId)) {
    return NextResponse.json({ error: "invalid_project_id" }, { status: 400 });
  }

  const supabase = getAdminClient();
  const { data: project, error } = await supabase
    .from("fleet_projects")
    .select("repo, default_branch")
    .eq("id", projectId)
    .eq("active", true)
    .maybeSingle();

  if (error) {
    console.error("[api/compose/prompts] project lookup failed:", error);
    return NextResponse.json({ error: "project_lookup_failed" }, { status: 500 });
  }
  if (!project) {
    return NextResponse.json({ error: "unknown_project" }, { status: 404 });
  }

  const result = await listPrompts(project.repo, project.default_branch);
  if (!result.configured) {
    return NextResponse.json(
      { configured: false },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  if (!result.ok) {
    return NextResponse.json({ configured: true, error: result.error }, { status: 502 });
  }
  return NextResponse.json(
    { configured: true, prompts: result.prompts },
    { headers: { "Cache-Control": "no-store" } },
  );
}
