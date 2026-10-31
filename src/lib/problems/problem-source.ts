import "server-only";
import type { ProblemRow } from "@/lib/database.types";
import { isRoundType, type CodeLanguage, type RoundType } from "@/lib/interview/rounds";
import { BUILT_IN, getProblem, rankProblems, roundTypeOf } from "@/lib/problems/catalog";
import type { InterviewerGuide, Problem, ProblemSummary } from "@/lib/problems/types";
import { createClient } from "@/lib/supabase/server";

// Built-in problems live in code; a workspace's own problems live in `problems` (ADR 0011).
// Custom problems get the slug `custom-<id>` on sessions, so both kinds load by slug.

export const customSlug = (id: string) => `custom-${id}`;
const customId = (slug: string) => (/^custom-[0-9a-f-]{36}$/.test(slug) ? slug.slice(7) : null);

const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

export function guideFrom(raw: unknown): InterviewerGuide {
  const g = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const clarifications = Array.isArray(g.clarifications)
    ? g.clarifications
        .filter((c): c is { q: string; a: string } => Boolean(c) && typeof c.q === "string" && typeof c.a === "string")
        .map(({ q, a }) => ({ q, a }))
    : [];
  return {
    clarifications,
    scale: list(g.scale),
    probes: list(g.probes),
    strongSignals: list(g.strongSignals),
    pitfalls: list(g.pitfalls),
    reference: list(g.reference),
  };
}

export function customToProblem(row: ProblemRow): Problem {
  return {
    id: row.id,
    slug: customSlug(row.id),
    version: row.version,
    roundType: isRoundType(row.round_type) ? row.round_type : "system_design",
    title: row.title,
    domain: "general",
    levels: row.levels as Problem["levels"],
    roles: [],
    focus: row.focus,
    summary: row.summary,
    prompt: row.prompt,
    language: (row.language ?? undefined) as CodeLanguage | undefined,
    starterCode: row.starter_code,
    guide: guideFrom(row.guide),
  };
}

/** Built-in or custom, by the slug stored on a session. RLS limits custom ones to the workspace. */
export async function loadProblem(slug: string): Promise<Problem | null> {
  const id = customId(slug);
  if (!id) return getProblem(slug);
  const supabase = await createClient();
  const { data } = await supabase.from("problems").select("*").eq("id", id).maybeSingle();
  return data ? customToProblem(data) : null;
}

export async function listCustomProblems(orgId: string, { includeArchived = false } = {}): Promise<Problem[]> {
  const supabase = await createClient();
  let query = supabase.from("problems").select("*").eq("org_id", orgId).order("created_at", { ascending: false });
  if (!includeArchived) query = query.is("archived_at", null);
  const { data } = await query;
  return (data ?? []).map(customToProblem);
}

/** What can be scheduled for a round: the workspace's own problems first, then the built-in ones by level. */
export async function problemsForRound(orgId: string, round: RoundType, seniority: string | null): Promise<ProblemSummary[]> {
  const custom = (await listCustomProblems(orgId)).filter((p) => roundTypeOf(p) === round);
  const builtIn = BUILT_IN.filter((p) => roundTypeOf(p) === round);
  return [...rankProblems({ domains: [], seniority, target_role: null }, custom), ...rankProblems({ domains: [], seniority, target_role: null }, builtIn)];
}
