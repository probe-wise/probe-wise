import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { requireMember } from "@/lib/dal";
import { ROUND_TYPES, isRoundType, roundLabel } from "@/lib/interview/rounds";
import { allProblemSummaries, toSummary } from "@/lib/problems/catalog";
import { domainLabel } from "@/lib/problems/labels";
import { listCustomProblems } from "@/lib/problems/problem-source";
import { SENIORITY_LEVELS, labelFor } from "@/lib/profile-options";

export const metadata: Metadata = { title: "Problems" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function ProblemsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="page grid gap-8 py-12">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="grid gap-2">
          <h1 className="text-[2.2rem]!">Problems</h1>
          <p className="lede measure">
            What your team interviews with: built-in problems and your own. Each has a candidate prompt and a private
            interviewer guide.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/rubrics" className="btn btn-secondary">
            Rubrics
          </Link>
          <Link href="/problems/new" className="btn btn-primary">
            New problem
          </Link>
        </div>
      </header>
      <Suspense fallback={<div className="skeleton h-96" aria-hidden="true" />}>
        <ProblemList searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function ProblemList({ searchParams }: { searchParams: SearchParams }) {
  const { org } = await requireMember("/problems");
  const params = await searchParams;
  const round = isRoundType(params.round) ? params.round : null;
  const showArchived = params.archived === "1";
  const custom = (await listCustomProblems(org.id, { includeArchived: showArchived })).map(toSummary);
  const all = [...custom, ...allProblemSummaries()];
  const problems = round ? all.filter((p) => p.roundType === round) : all;
  const href = (r: string | null) => (r ? `/problems?round=${r}` : "/problems");

  return (
    <div className="grid gap-6">
      <nav aria-label="Filter by round" className="flex flex-wrap gap-2">
        <Link href={href(null)} className={`chip ${!round ? "border-marker! text-ink!" : ""}`} aria-current={!round ? "page" : undefined}>
          All
        </Link>
        {ROUND_TYPES.map((r) => (
          <Link
            key={r.value}
            href={href(r.value)}
            className={`chip ${round === r.value ? "border-marker! text-ink!" : ""}`}
            aria-current={round === r.value ? "page" : undefined}
          >
            {r.label}
          </Link>
        ))}
      </nav>
      {problems.length === 0 ? <p className="muted">No problems here yet.</p> : null}
      <ul className="grid gap-3 md:grid-cols-2">
        {problems.map((p) => (
          <li key={p.slug} className="panel grid content-start gap-2">
            <div className="flex flex-wrap gap-2 text-[0.8rem]">
              <span className="chip">{roundLabel(p.roundType)}</span>
              {p.custom ? <span className="chip border-marker! text-ink!">Your team</span> : null}
              {p.roundType === "system_design" && !p.custom ? <span className="chip">{domainLabel(p.domain)}</span> : null}
              {p.levels.length ? (
                <span className="chip">
                  {labelFor(SENIORITY_LEVELS, p.levels[0])}
                  {p.levels.length > 1 ? `–${labelFor(SENIORITY_LEVELS, p.levels[p.levels.length - 1])}` : ""}
                </span>
              ) : null}
            </div>
            <h2 className="text-[1.12rem]!">
              <Link href={p.custom ? `/problems/custom/${p.id}` : `/problems/${p.slug}`} className="hover:underline">
                {p.title}
              </Link>
            </h2>
            {p.summary ? <p className="muted text-[0.95rem]">{p.summary}</p> : null}
            {p.focus ? <p className="faint">Follow-ups on {p.focus.toLowerCase()}.</p> : null}
          </li>
        ))}
      </ul>
      <p className="faint">
        <Link href={showArchived ? href(round) : `${href(round)}${round ? "&" : "?"}archived=1`} className="link">
          {showArchived ? "Hide archived problems" : "Show archived problems"}
        </Link>
      </p>
    </div>
  );
}
