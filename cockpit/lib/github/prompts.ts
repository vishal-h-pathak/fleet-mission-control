import "server-only";

import { isValidPromptRef } from "@/lib/compose/validate.mjs";

// Server-only reader for "committed prompts only": lists and fetches
// ops/prompts/PROMPT_*.md from a project's GitHub repo at its default branch
// HEAD, via the GitHub REST contents API, using a fine-grained read-only
// token (COCKPIT_GITHUB_TOKEN, contents:read on the fixed repo set — server
// env only, never NEXT_PUBLIC_*). The `server-only` import makes the build
// fail if this is ever pulled into client code, same posture as
// lib/supabase/admin.ts.
//
// Per ops/prompts/PROMPT_mcv2_compose.md §1: "No token configured => Compose
// renders a clear 'read-only: GitHub token not configured' state, everything
// else in the cockpit unaffected." Modeled as a `configured: false` sentinel
// rather than throwing, so callers can render that state instead of a 500.

const PROMPTS_DIR = "ops/prompts";
const PROMPT_NAME_RE = /^PROMPT_.*\.md$/;
const CACHE_TTL_MS = 60_000;

export interface PromptFile {
  /** Filename, e.g. "PROMPT_mcv2_compose.md". */
  name: string;
  /** Repo-relative path, e.g. "ops/prompts/PROMPT_mcv2_compose.md". */
  path: string;
}

export type ListPromptsResult =
  | { configured: false }
  | { configured: true; ok: true; prompts: PromptFile[] }
  | { configured: true; ok: false; error: string };

export type GetPromptContentResult =
  | { configured: false }
  | { configured: true; ok: true; content: string }
  | { configured: true; ok: false; error: string };

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

// Module-level cache — resets on server restart/redeploy, which is fine: it
// exists only to keep a phone operator from re-hammering the GitHub API
// while stepping through the wizard, not as a durable cache.
const cache = new Map<string, CacheEntry<unknown>>();

function getCached<T>(key: string): T | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() >= entry.expiresAt) {
    cache.delete(key);
    return undefined;
  }
  return entry.value as T;
}

function setCached<T>(key: string, value: T): void {
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

function getToken(): string | null {
  const token = process.env.COCKPIT_GITHUB_TOKEN;
  return token && token.trim() ? token.trim() : null;
}

function githubHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "mcv2-cockpit",
  };
}

interface RawContentsEntry {
  name: string;
  path: string;
  type: string;
}

interface RawContentsFile {
  name: string;
  path: string;
  type: string;
  encoding?: string;
  content?: string;
}

/**
 * Lists `ops/prompts/PROMPT_*.md` at `repo`'s `ref` (the project's
 * default_branch). `repo` is `owner/name`, as stored on fleet_projects.
 */
export async function listPrompts(
  repo: string,
  ref: string,
): Promise<ListPromptsResult> {
  const token = getToken();
  if (!token) return { configured: false };

  const cacheKey = `list:${repo}@${ref}`;
  const cached = getCached<PromptFile[]>(cacheKey);
  if (cached) return { configured: true, ok: true, prompts: cached };

  const url = `https://api.github.com/repos/${repo}/contents/${PROMPTS_DIR}?ref=${encodeURIComponent(ref)}`;
  let res: Response;
  try {
    res = await fetch(url, { headers: githubHeaders(token) });
  } catch (e) {
    console.error(`[github/prompts] list fetch failed for ${repo}@${ref}:`, e);
    return { configured: true, ok: false, error: "github_fetch_failed" };
  }

  if (res.status === 404) {
    // No ops/prompts dir on this repo/ref yet — not an error, just empty.
    setCached(cacheKey, []);
    return { configured: true, ok: true, prompts: [] };
  }
  if (!res.ok) {
    console.error(`[github/prompts] list ${repo}@${ref} returned ${res.status}`);
    return { configured: true, ok: false, error: `github_${res.status}` };
  }

  const entries = (await res.json()) as RawContentsEntry[] | RawContentsEntry;
  const list = Array.isArray(entries) ? entries : [entries];
  const prompts: PromptFile[] = list
    .filter((e) => e.type === "file" && PROMPT_NAME_RE.test(e.name))
    .map((e) => ({ name: e.name, path: e.path }))
    .sort((a, b) => a.name.localeCompare(b.name));

  setCached(cacheKey, prompts);
  return { configured: true, ok: true, prompts };
}

/**
 * Fetches the full text of one committed prompt file. `path` must be exactly
 * an `ops/prompts/PROMPT_*.md` path (validated here, defense-in-depth beyond
 * whatever the caller already checked) — this function must never become a
 * proxy for reading arbitrary files out of the repo.
 */
export async function getPromptContent(
  repo: string,
  ref: string,
  path: string,
): Promise<GetPromptContentResult> {
  const token = getToken();
  if (!token) return { configured: false };

  if (!isValidPromptRef(path)) {
    return { configured: true, ok: false, error: "invalid_path" };
  }

  const cacheKey = `content:${repo}@${ref}:${path}`;
  const cached = getCached<string>(cacheKey);
  if (cached !== undefined) return { configured: true, ok: true, content: cached };

  const url = `https://api.github.com/repos/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`;
  let res: Response;
  try {
    res = await fetch(url, { headers: githubHeaders(token) });
  } catch (e) {
    console.error(`[github/prompts] content fetch failed for ${repo}@${ref}:${path}:`, e);
    return { configured: true, ok: false, error: "github_fetch_failed" };
  }

  if (!res.ok) {
    console.error(`[github/prompts] content ${repo}@${ref}:${path} returned ${res.status}`);
    return { configured: true, ok: false, error: `github_${res.status}` };
  }

  const body = (await res.json()) as RawContentsFile;
  if (body.type !== "file" || body.encoding !== "base64" || typeof body.content !== "string") {
    return { configured: true, ok: false, error: "unexpected_content_shape" };
  }
  const content = Buffer.from(body.content.replace(/\n/g, ""), "base64").toString("utf8");

  setCached(cacheKey, content);
  return { configured: true, ok: true, content };
}
