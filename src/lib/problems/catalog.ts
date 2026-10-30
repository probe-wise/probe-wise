import "server-only";
import type { ProfileRow } from "@/lib/database.types";
import { PROBLEMS, getProblem } from "@/lib/problems/bank";
import type { Problem, ProblemPrompt, ProblemSummary } from "@/lib/problems/types";

export { getProblem };

/** Strip the confidential guide and the prompt: safe to pass to client components. */
export function toSummary(p: Problem): ProblemSummary {
  const { slug, version, title, domain, levels, roles, focus, summary } = p;
  return { slug, version, title, domain, levels, roles, focus, summary };
}

/** The candidate-facing part, stored on the session at creation (ADR 0004). */
export function toPromptSnapshot(problem: Problem): ProblemPrompt & { focus: string } {
  return { summary: problem.summary, prompt: problem.prompt, focus: problem.focus };
}

type Ranking = Pick<ProfileRow, "domains" | "seniority" | "target_role">;

/**
 * Ranks the bank for a member: their domains first, then problems calibrated for their
 * level, then ones that suit their role. Ties keep bank order, so results are stable.
 */
export function rankProblems(profile: Ranking): ProblemSummary[] {
  const score = (p: Problem) =>
    (p.domain !== "general" && profile.domains.includes(p.domain) ? 4 : 0) +
    (profile.seniority && (p.levels as readonly string[]).includes(profile.seniority) ? 2 : 0) +
    (profile.target_role && (p.roles as readonly string[]).includes(profile.target_role) ? 1 : 0);
  return PROBLEMS.map((p, i) => ({ p, i, s: score(p) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map(({ p }) => toSummary(p));
}

/** Up to `limit` problems from the member's domains, interleaved so each domain shows up. */
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

export const allProblemSummaries = () => PROBLEMS.map(toSummary);
