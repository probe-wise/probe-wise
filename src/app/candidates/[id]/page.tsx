import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { CandidateForm } from "@/components/candidates/candidate-form";
import { DeleteCandidateForm } from "@/components/candidates/delete-candidate-form";
import { ScheduleForm, type RubricChoice } from "@/components/candidates/schedule-form";
import { CalendarNotice } from "@/components/calendar-notice";
import { SessionList } from "@/components/interview/session-list";
import { requireMember } from "@/lib/dal";
import { listWorkspaceSessions } from "@/lib/interview/session-dal";
import { ROUND_VALUES, type RoundType } from "@/lib/interview/rounds";
import { problemsForRound } from "@/lib/problems/problem-source";
import { SENIORITY_LEVELS, labelFor } from "@/lib/profile-options";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Candidate" };

type Params = Promise<{ id: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function CandidatePage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  return (
    <div className="page py-12">
      <Suspense fallback={<div className="skeleton h-[60dvh]" aria-hidden="true" />}>
        <Candidate params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Candidate({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const { id } = await params;
  const query = await searchParams;
  const { org, member } = await requireMember(`/candidates/${id}`);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await createClient();
  const [{ data: candidate }, { data: team }, sessions, { data: loops }, { data: rubricRows }] = await Promise.all([
    supabase.from("candidates").select("*").eq("id", id).eq("org_id", org.id).maybeSingle(),
    supabase.from("org_members").select("user_id, display_name").eq("org_id", org.id).order("display_name"),
    listWorkspaceSessions({ candidateId: id }),
    supabase.from("interview_loops").select("id, name, created_at").eq("candidate_id", id).order("created_at", { ascending: false }),
    supabase.from("rubrics").select("id, name, round_type, is_default").eq("org_id", org.id).is("archived_at", null).order("name"),
  ]);
  if (!candidate) notFound();

  const problemLists = await Promise.all(ROUND_VALUES.map((r) => problemsForRound(org.id, r, candidate.seniority)));
  const problems = Object.fromEntries(ROUND_VALUES.map((r, i) => [r, problemLists[i]])) as Record<RoundType, (typeof problemLists)[number]>;
  const rubrics = Object.fromEntries(
    ROUND_VALUES.map((r) => [
      r,
      (rubricRows ?? []).filter((x) => x.round_type === r).map((x) => ({ id: x.id, name: x.name, isDefault: x.is_default })),
    ]),
  ) as Record<RoundType, RubricChoice[]>;
  const open = sessions.filter((s) => s.status === "lobby" || s.status === "in_progress").length;

  return (
    <div className="grid gap-12">
      <CalendarNotice params={query} />
      <header className="grid gap-2">
        <Link href="/candidates" className="link text-[0.95rem]">
          ← Candidates
        </Link>
        <h1 className="text-[2.2rem]!">{candidate.full_name}</h1>
        <p className="lede">
          {[candidate.role_title, candidate.seniority ? `${labelFor(SENIORITY_LEVELS, candidate.seniority)} level` : null, candidate.email]
            .filter(Boolean)
            .join(" · ") || "No details yet"}
        </p>
      </header>

      <div className="grid gap-10 lg:grid-cols-[1.3fr_1fr]">
        <div className="grid content-start gap-10">
          {loops?.length ? (
            <section aria-labelledby="loops-h" className="grid gap-3">
              <h2 id="loops-h">Loops</h2>
              <ul className="grid gap-2">
                {loops.map((l) => (
                  <li key={l.id}>
                    <Link href={`/loops/${l.id}`} className="grid rounded-lg border border-grid bg-board-raised px-3 py-2 hover:border-ink-faint">
                      <span className="font-semibold">{l.name}</span>
                      <span className="faint">
                        {sessions.filter((s) => s.loop_id === l.id).length} rounds · summary and comparison
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section aria-labelledby="sessions-h" className="grid gap-3">
            <h2 id="sessions-h">Interviews</h2>
            <SessionList
              sessions={sessions}
              showCandidate={false}
              empty={<p className="muted">No interviews yet. Schedule one to get started.</p>}
            />
          </section>

          <section aria-labelledby="edit-h" className="grid gap-4">
            <h2 id="edit-h">Details</h2>
            <CandidateForm candidate={candidate} />
          </section>

          {member.role === "admin" ? (
            <section aria-labelledby="danger-h" className="panel grid gap-3 border-probe/40!">
              <h2 id="danger-h" className="text-[1.2rem]!">
                Delete candidate
              </h2>
              <p className="muted">For example when they withdraw or ask for their data to be removed.</p>
              <div>
                <DeleteCandidateForm id={candidate.id} name={candidate.full_name} />
              </div>
            </section>
          ) : null}
        </div>

        <aside className="panel grid content-start gap-4 self-start">
          <h2 className="text-[1.3rem]!">Schedule an interview</h2>
          {open >= 8 ? (
            <p className="muted">This candidate has 8 open interviews. Finish or cancel some to schedule more.</p>
          ) : (
            <ScheduleForm candidateId={candidate.id} problems={problems} rubrics={rubrics} team={team ?? []} me={member.user_id} />
          )}
          <p className="faint">
            Add several rounds to schedule a loop. With a time set, calendar invites go out (Google Calendar or .ics,
            per your workspace&apos;s setting). Send the candidate their room link from the lobby when you start.
          </p>
        </aside>
      </div>
    </div>
  );
}
