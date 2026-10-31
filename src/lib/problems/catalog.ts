import "server-only";
import { PROBLEMS } from "@/lib/problems/bank";
import { BEHAVIOURAL_PROBLEMS, CODING_PROBLEMS } from "@/lib/problems/bank-rounds";
import type { Problem, ProblemPrompt, ProblemSummary } from "@/lib/problems/types";
import type { RoundType } from "@/lib/interview/rounds";

/** Every built-in problem, of every round type. */
export const BUILT_IN: readonly Problem[] = [...PROBLEMS, ...CODING_PROBLEMS, ...BEHAVIOURAL_PROBLEMS];
const BY_SLUG = new Map(BUILT_IN.map((p) => [p.slug, p]));

/** A built-in problem by slug. Custom problems load through problem-source.ts. */
export const getProblem = (slug: string) => BY_SLUG.get(slug) ?? null;

export const roundTypeOf = (p: Pick<Problem, "roundType">): RoundType => p.roundType ?? "system_design";

/** Strip the confidential guide and the prompt: safe to pass to client components. */
export function toSummary(p: Problem): ProblemSummary {
  const { slug, version, title, domain, levels, roles, focus, summary, language, id } = p;
  return { slug, version, title, domain, levels, roles, focus, summary, language, id, roundType: roundTypeOf(p), custom: Boolean(id) };
}

/** The candidate-facing part, stored on the session at creation (ADR 0004). */
export function toPromptSnapshot(
  problem: Problem,
): ProblemPrompt & { focus: string; language?: string; starter_code?: string } {
  const base = { summary: problem.summary, prompt: problem.prompt, focus: problem.focus };
  return roundTypeOf(problem) === "coding"
    ? { ...base, language: problem.language ?? "python", starter_code: problem.starterCode ?? "" }
    : base;
}

type Ranking = { domains: readonly string[]; seniority: string | null; target_role: string | null };

/**
 * Ranks problems for a hiring need: the given domains first, then problems calibrated for
 * the level, then ones that suit the role. Ties keep the input order, so results are stable.
 */
export function rankProblems(profile: Ranking, problems: readonly Problem[] = PROBLEMS): ProblemSummary[] {
  const score = (p: Problem) =>
    (p.domain !== "general" && profile.domains.includes(p.domain) ? 4 : 0) +
    (profile.seniority && (p.levels as readonly string[]).includes(profile.seniority) ? 2 : 0) +
    (profile.target_role && (p.roles as readonly string[]).includes(profile.target_role) ? 1 : 0);
  return problems
    .map((p, i) => ({ p, i, s: score(p) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map(({ p }) => toSummary(p));
}

/** Up to `limit` problems from the given domains, interleaved so each domain shows up. */
export function queuedProblems(profile: Ranking, limit = 4): ProblemSummary[] {
  const ranked = rankProblems(profile);
  const out: ProblemSummary[] = [];
  for (let round = 0; out.length < limit && round < 3; round++) {
    for (const d of profile.domains) {
      const item = ranked.filter((p) => p.domain === d)[round];
      if (item && out.length < limit) out.push(item);
    }
  }
  for (const p of ranked) if (out.length < limit && !out.includes(p)) out.push(p);
  return out;
}

export const allProblemSummaries = () => BUILT_IN.map(toSummary);
