import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { requireMember } from "@/lib/dal";
import { rankProblems } from "@/lib/problems/catalog";
import { domainLabel } from "@/lib/problems/labels";
import { DOMAINS, SENIORITY_LEVELS, labelFor } from "@/lib/profile-options";

export const metadata: Metadata = { title: "Problems" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function ProblemsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="page grid gap-8 py-12">
      <header className="grid gap-2">
        <h1 className="text-[2.2rem]!">Problems</h1>
        <p className="lede measure">
          Each problem comes with an interviewer guide and a rubric. Problems from your domains and level are listed
          first.
        </p>
      </header>
      <Suspense fallback={<div className="skeleton h-96" aria-hidden="true" />}>
        <ProblemList searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function ProblemList({ searchParams }: { searchParams: SearchParams }) {
  const { profile } = await requireMember("/problems");
  const params = await searchParams;
  const filter = typeof params.domain === "string" ? params.domain : null;
  const all = rankProblems(profile);
  const problems = filter ? all.filter((p) => p.domain === filter) : all;
  const domains = ["general", ...DOMAINS.map((d) => d.value)] as const;

  return (
    <div className="grid gap-6">
      <nav aria-label="Filter by domain" className="flex flex-wrap gap-2">
        <Link href="/problems" className={`chip ${!filter ? "border-marker! text-ink!" : ""}`} aria-current={!filter ? "page" : undefined}>
          All
        </Link>
        {domains.map((d) => (
          <Link
            key={d}
            href={`/problems?domain=${d}`}
            className={`chip ${filter === d ? "border-marker! text-ink!" : ""}`}
            aria-current={filter === d ? "page" : undefined}
          >
            {domainLabel(d)}
          </Link>
        ))}
      </nav>
      {problems.length === 0 ? <p className="muted">No problems in that domain yet.</p> : null}
      <ul className="grid gap-3 md:grid-cols-2">
        {problems.map((p) => (
          <li key={p.slug} className="panel grid content-start gap-2">
            <div className="flex flex-wrap gap-2 text-[0.8rem]">
              <span className="chip">{domainLabel(p.domain)}</span>
              <span className="chip">
                {labelFor(SENIORITY_LEVELS, p.levels[0])}
                {p.levels.length > 1 ? `–${labelFor(SENIORITY_LEVELS, p.levels[p.levels.length - 1])}` : ""}
              </span>
            </div>
            <h2 className="text-[1.12rem]!">
              <Link href={`/problems/${p.slug}`} className="hover:underline">
                {p.title}
              </Link>
            </h2>
            <p className="muted text-[0.95rem]">{p.summary}</p>
            <p className="faint">Follow-ups on {p.focus.toLowerCase()}.</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
