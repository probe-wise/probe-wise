import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { requireMember } from "@/lib/dal";
import { SessionList } from "@/components/interview/session-list";
import { listMySessions } from "@/lib/interview/session-dal";
import { queuedProblems } from "@/lib/problems/catalog";
import { domainLabel } from "@/lib/problems/labels";
import { DOMAINS, SENIORITY_LEVELS, TARGET_ROLES, WEAK_AREAS, labelFor } from "@/lib/profile-options";
import { daysUntil, joinList } from "@/lib/profile-form-values";
import { isoDate } from "@/lib/profile-schema";

export const metadata: Metadata = { title: "Dashboard" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function DashboardPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="page py-12">
      <Suspense fallback={<DashboardSkeleton />}>
        <Dashboard searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="grid gap-6" aria-hidden="true">
      <div className="skeleton h-10 w-72" />
      <div className="skeleton h-5 w-96 max-w-full" />
      <div className="skeleton h-64 w-full" />
    </div>
  );
}

async function Dashboard({ searchParams }: { searchParams: SearchParams }) {
  const { profile } = await requireMember("/dashboard");
  const params = await searchParams;

  const firstName = (profile.full_name ?? "").split(" ")[0] || "there";
  const level = labelFor(SENIORITY_LEVELS, profile.seniority);
  const role = labelFor(TARGET_ROLES, profile.target_role);
  const domainLabels = profile.domains.map((d) => labelFor(DOMAINS, d));
  const weakLabels = profile.weak_areas.map((w) => labelFor(WEAK_AREAS, w));
  const problems = queuedProblems(profile);
  const sessions = await listMySessions(8);

  return (
    <div className="grid gap-12">
      {params.welcome === "1" ? (
        <p className="notice notice-success" role="status">
          Your profile is set up. Here&apos;s what&apos;s queued for you.
        </p>
      ) : null}

      <header className="grid gap-3">
        <h1 className="text-[2.2rem]!">Hi {firstName}</h1>
        <p className="lede measure">
          Preparing for {level.toLowerCase()} {role} interviews in {joinList(domainLabels)}.{" "}
          <Link href="/profile" className="link text-base">
            Edit profile
          </Link>
        </p>
        <InterviewCountdown date={profile.interview_date} />
      </header>

      <div className="grid gap-10 lg:grid-cols-[1.6fr_1fr]">
        <section aria-labelledby="queued-heading" className="grid content-start gap-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <h2 id="queued-heading">Problems queued for you</h2>
              <p className="muted mt-2">Picked from your domains and level. Practise solo or invite an interviewer.</p>
            </div>
            <Link href="/problems" className="link">
              All problems
            </Link>
          </div>
          <ol className="grid gap-3">
            {problems.map((p) => (
              <li key={p.slug} className="panel grid gap-1">
                <span className="text-sm text-ink-faint">{domainLabel(p.domain)}</span>
                <h3>{p.title}</h3>
                <p className="muted text-[0.95rem]">Expect follow-ups on {p.focus.toLowerCase()}.</p>
                <div className="mt-2">
                  <Link href={`/problems/${p.slug}`} className="btn btn-secondary">
                    Start
                  </Link>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <aside className="grid content-start gap-8">
          <section aria-labelledby="history-heading" className="grid gap-2">
            <h2 id="history-heading" className="text-[1.3rem]!">
              Past sessions
            </h2>
            <SessionList
              sessions={sessions}
              empty={
                <p className="muted">
                  No sessions yet. After your first interview, your scores for each phase and the interviewer&apos;s
                  notes show up here.
                </p>
              }
            />
            {sessions.length ? (
              <Link href="/interview" className="link text-[0.95rem]">
                All sessions
              </Link>
            ) : null}
          </section>

          <section aria-labelledby="focus-heading" className="grid gap-2">
            <h2 id="focus-heading" className="text-[1.3rem]!">
              Focus areas
            </h2>
            {weakLabels.length ? (
              <>
                <p className="muted">The interviewer will push harder on:</p>
                <ul className="flex flex-wrap gap-2">
                  {weakLabels.map((w) => (
                    <li key={w} className="rounded-md border border-grid bg-board-raised px-2.5 py-1 text-sm">
                      {w}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="muted">
                None picked. <Link href="/profile" className="link">Choose a few</Link> and the interviewer will dig
                into them.
              </p>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}

function InterviewCountdown({ date }: { date: string | null }) {
  if (!date) return null;
  // Server time in UTC. Off by at most a day near midnight, which is fine for a countdown.
  const days = daysUntil(date, isoDate(new Date()));
  if (days < 0) {
    return (
      <p className="text-[0.95rem] text-ink-soft">
        Your interview date has passed.{" "}
        <Link href="/profile" className="link">
          Update it
        </Link>{" "}
        if you have another one coming up.
      </p>
    );
  }
  const text = days === 0 ? "Your interview is today. Good luck." : days === 1 ? "Your interview is tomorrow." : `Your interview is in ${days} days.`;
  return <p className="font-semibold text-marker">{text}</p>;
}
