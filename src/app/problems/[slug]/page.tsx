import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { InterviewerGuide } from "@/components/interview/interviewer-guide";
import { requireMember } from "@/lib/dal";
import { roundOf, roundPlanFor } from "@/lib/interview/rounds";
import { getProblem, roundTypeOf } from "@/lib/problems/catalog";
import { domainLabel } from "@/lib/problems/labels";
import { SENIORITY_LEVELS, labelFor } from "@/lib/profile-options";

export const metadata: Metadata = { title: "Problem" };

type Params = Promise<{ slug: string }>;

export default function ProblemPage({ params }: { params: Params }) {
  return (
    <div className="page py-12">
      <Suspense fallback={<div className="skeleton h-96" aria-hidden="true" />}>
        <ProblemDetail params={params} />
      </Suspense>
    </div>
  );
}

async function ProblemDetail({ params }: { params: Params }) {
  const { slug } = await params;
  await requireMember(`/problems/${slug}`);
  const problem = getProblem(slug);
  if (!problem) notFound();
  const level = problem.levels.includes("senior") ? "senior" : problem.levels[0];
  const round = roundOf(roundTypeOf(problem));
  const plan = roundPlanFor(round.value, level);
  const total = Object.values(plan).reduce((a, b) => a + b, 0);

  return (
    <div className="grid gap-10 lg:grid-cols-[1.5fr_1fr]">
      <article className="grid content-start gap-5">
        <Link href="/problems" className="link text-[0.95rem]">
          ← All problems
        </Link>
        <p className="faint">
          {round.label}
          {round.value === "system_design" ? ` · ${domainLabel(problem.domain)}` : ""} ·{" "}
          {problem.levels.map((l) => labelFor(SENIORITY_LEVELS, l)).join(", ")}
        </p>
        <h1 className="text-[2.2rem]!">{problem.title}</h1>
        <p className="lede">{problem.prompt}</p>
        <p className="muted">Expect follow-ups on {problem.focus.toLowerCase()}.</p>
        {problem.starterCode ? (
          <pre className="overflow-auto rounded-lg border border-grid bg-board-raised p-3 font-mono text-[0.85rem]">{problem.starterCode}</pre>
        ) : null}

        <section className="grid gap-3" aria-labelledby="plan-h">
          <h2 id="plan-h" className="text-[1.3rem]!">
            How the {total} minutes are split
          </h2>
          <p className="faint">
            For a {labelFor(SENIORITY_LEVELS, level).toLowerCase()} candidate. The split follows the candidate&apos;s level
            when you schedule.
          </p>
          <ol className="grid gap-2">
            {round.phases.map((p, i) => (
              <li key={p.value} className="grid grid-cols-[2rem_1fr_auto] items-baseline gap-2">
                <span className="faint tabular-nums">{i + 1}.</span>
                <span>
                  <strong>{p.label}</strong> <span className="muted">· {p.goal}</span>
                </span>
                <span className="tabular-nums text-ink-soft">{plan[p.value]} min</span>
              </li>
            ))}
          </ol>
        </section>
      </article>

      <aside className="panel grid content-start gap-4 self-start">
        <h2 className="text-[1.3rem]!">Interviewer guide</h2>
        <p className="faint">Your team only. Candidates see the prompt, never this.</p>
        <InterviewerGuide guide={problem.guide} phase={null} roundType={round.value} />
        <p className="faint">
          To use this problem, open a{" "}
          <Link href="/candidates" className="link">
            candidate
          </Link>{" "}
          and schedule an interview.
        </p>
      </aside>
    </div>
  );
}
