import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { StartSessionForm } from "@/components/interview/start-session-form";
import { requireMember } from "@/lib/dal";
import { PHASES, phasePlanFor, totalMinutes } from "@/lib/interview/phases";
import { getProblem } from "@/lib/problems/catalog";
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
  const { profile } = await requireMember(`/problems/${slug}`);
  const problem = getProblem(slug);
  if (!problem) notFound();
  const plan = phasePlanFor(profile.seniority);

  return (
    <div className="grid gap-10 lg:grid-cols-[1.5fr_1fr]">
      <article className="grid content-start gap-5">
        <Link href="/problems" className="link text-[0.95rem]">
          ← All problems
        </Link>
        <p className="faint">
          {domainLabel(problem.domain)} ·{" "}
          {problem.levels.map((l) => labelFor(SENIORITY_LEVELS, l)).join(", ")}
        </p>
        <h1 className="text-[2.2rem]!">{problem.title}</h1>
        <p className="lede">{problem.prompt}</p>
        <p className="muted">Expect follow-ups on {problem.focus.toLowerCase()}.</p>

        <section className="grid gap-3" aria-labelledby="plan-h">
          <h2 id="plan-h" className="text-[1.3rem]!">
            How the {totalMinutes(plan)} minutes are split
          </h2>
          <p className="faint">Timed for {labelFor(SENIORITY_LEVELS, profile.seniority).toLowerCase()} interviews.</p>
          <ol className="grid gap-2">
            {PHASES.map((p, i) => (
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
        <h2 className="text-[1.3rem]!">Start a session</h2>
        <StartSessionForm slug={problem.slug} />
      </aside>
    </div>
  );
}
