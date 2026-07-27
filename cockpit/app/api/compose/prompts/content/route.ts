import { NextResponse, type NextRequest } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { getPromptContent } from "@/lib/github/prompts";
import { isValidPromptRef } from "@/lib/compose/validate.mjs";

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Authed via proxy.ts. Preview screen's "expand full prompt content" — fetches
// one committed prompt's full text. `path` is validated against the same
// PROMPT_REF_RE the draft route and the (future) agent enforce, before it
// ever reaches the GitHub API call — this route must never become a proxy
// for reading arbitrary files out of the repo.
export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("project_id");
  const path = req.nextUrl.searchParams.get("path");

  if (!projectId || !UUID_RE.test(projectId)) {
    return NextResponse.json({ error: "invalid_project_id" }, { status: 400 });
  }
  if (!path || !isValidPromptRef(path)) {
    return NextResponse.json({ error: "invalid_path" }, { status: 400 });
  }

  const supabase = getAdminClient();
  const { data: project, error } = await supabase
    .from("fleet_projects")
    .select("repo, default_branch")
    .eq("id", projectId)
    .eq("active", true)
    .maybeSingle();

  if (error) {
    console.error("[api/compose/prompts/content] project lookup failed:", error);
    return NextResponse.json({ error: "project_lookup_failed" }, { status: 500 });
  }
  if (!project) {
    return NextResponse.json({ error: "unknown_project" }, { status: 404 });
  }

  const result = await getPromptContent(project.repo, project.default_branch, path);
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
    { configured: true, content: result.content },
    { headers: { "Cache-Control": "no-store" } },
  );
}
