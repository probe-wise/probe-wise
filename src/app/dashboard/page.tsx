import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { SessionList } from "@/components/interview/session-list";
import { requireMember } from "@/lib/dal";
import { listWorkspaceSessions } from "@/lib/interview/session-dal";
import { createClient } from "@/lib/supabase/server";

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
  const { org, member } = await requireMember("/dashboard");
  const params = await searchParams;
  const supabase = await createClient();

  const [mine, upcoming, finished, { count: candidateCount }, { data: myRows }] = await Promise.all([
    listWorkspaceSessions({ mineOnly: true, status: ["lobby", "in_progress", "completed"], limit: 30 }),
    listWorkspaceSessions({ status: ["lobby", "in_progress"], limit: 10 }),
    listWorkspaceSessions({ status: ["completed"], limit: 8 }),
    supabase.from("candidates").select("id", { count: "exact", head: true }).eq("org_id", org.id),
    supabase.from("session_participants").select("id").eq("user_id", member.user_id).eq("role", "interviewer"),
  ]);
  // My own scorecards are always readable: which finished interviews still need mine?
  const { data: submitted } = await supabase
    .from("session_evaluations")
    .select("session_id")
    .in("participant_id", (myRows ?? []).map((r) => r.id))
    .not("submitted_at", "is", null);
  const done = new Set((submitted ?? []).map((e) => e.session_id));
  const mineOpen = mine.filter((s) => s.status !== "completed");
  const needsScorecard = mine.filter(
    (s) => s.status === "completed" && s.interviewers.some((i) => i.user_id === member.user_id && i.joined) && !done.has(s.id),
  );
  const firstName = member.display_name.split(" ")[0];

  return (
    <div className="grid gap-12">
      {params.welcome === "1" ? (
        <p className="notice notice-success" role="status">
          Welcome to {org.name}. Add a candidate to schedule your first interview
          {member.role === "admin" ? ", or invite your team" : ""}.
        </p>
      ) : null}

      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="grid gap-2">
          <h1 className="text-[2.2rem]!">Hi {firstName}</h1>
          <p className="lede">
            {org.name} · {candidateCount ?? 0} candidate{candidateCount === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/candidates/new" className="btn btn-primary">
            Add candidate
          </Link>
          {member.role === "admin" ? (
            <Link href="/team" className="btn btn-secondary">
              Invite your team
            </Link>
          ) : null}
        </div>
      </header>

      <div className="grid gap-10 lg:grid-cols-[1.4fr_1fr]">
        <div className="grid content-start gap-10">
          {needsScorecard.length ? (
            <section aria-labelledby="todo-h" className="grid gap-3">
              <h2 id="todo-h">Scorecards to write</h2>
              <p className="muted">Write these while the interview is fresh. Other scorecards unlock once you submit.</p>
              <SessionList sessions={needsScorecard} empty={null} />
            </section>
          ) : null}
          <section aria-labelledby="mine-h" className="grid gap-3">
            <h2 id="mine-h">Your upcoming interviews</h2>
            <SessionList
              sessions={mineOpen}
              empty={<p className="muted">Nothing scheduled for you. Interviews you&apos;re assigned to show up here.</p>}
            />
          </section>
        </div>

        <aside className="grid content-start gap-8">
          <section aria-labelledby="team-h" className="grid gap-2">
            <h2 id="team-h" className="text-[1.3rem]!">
              Across the team
            </h2>
            <SessionList sessions={upcoming} empty={<p className="muted">No interviews scheduled.</p>} />
          </section>
          <section aria-labelledby="recent-h" className="grid gap-2">
            <h2 id="recent-h" className="text-[1.3rem]!">
              Recently finished
            </h2>
            <SessionList sessions={finished} empty={<p className="muted">No finished interviews yet.</p>} />
            {finished.length ? (
              <Link href="/interview" className="link text-[0.95rem]">
                All interviews
              </Link>
            ) : null}
          </section>
        </aside>
      </div>
    </div>
  );
}
