import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { InterviewerJoinForm } from "@/components/interview/interviewer-join-form";
import { InterviewRoom } from "@/components/interview/room";
import { requireViewer } from "@/lib/dal";
import { isEmailConfigured } from "@/lib/email";
import { getMyInterviewerNotes, getSessionCandidate, getSessionEvents, getSessionView } from "@/lib/interview/session-dal";
import { loadProblem } from "@/lib/problems/problem-source";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Interview room" };

type Params = Promise<{ id: string }>;

export default function InterviewRoomPage({ params }: { params: Params }) {
  return (
    <Suspense fallback={<div className="skeleton m-6 h-[70dvh]" aria-label="Loading the interview room" />}>
      <Room params={params} />
    </Suspense>
  );
}

async function Room({ params }: { params: Params }) {
  const { id } = await params;
  const viewer = await requireViewer(`/interview/${id}`);
  const view = await getSessionView(id);
  if (!view) notFound(); // not allowed looks the same as not existing
  const { session, participants, me, isStaff } = view;

  // Teammates who haven't joined: consent screen, or the review once it's over.
  if (!me) {
    if (session.status === "completed") redirect(`/interview/${id}/review`);
    return <JoinGate sessionId={id} title={session.problem_title} status={session.status} participants={participants} viewerId={viewer.id} />;
  }
  if (session.status === "completed" && me.role === "interviewer") redirect(`/interview/${id}/review`);

  const isInterviewer = me.role === "interviewer";
  const supabase = await createClient();
  const staffView = isInterviewer && isStaff;
  const [events, privateNotes, { data: org }, problem, candidate] = await Promise.all([
    getSessionEvents(id, { includeBoard: false }),
    isInterviewer ? getMyInterviewerNotes(id, me.id) : Promise.resolve(""),
    supabase.from("organizations").select("name").eq("id", session.org_id).maybeSingle(),
    staffView ? loadProblem(session.problem_slug) : Promise.resolve(null),
    staffView ? getSessionCandidate(session.candidate_id) : Promise.resolve(null),
  ]);

  // The interviewer guide is confidential: it's only put into the page for interviewers (ADR 0004).
  const guide = staffView ? (problem?.guide ?? null) : null;

  return (
    <InterviewRoom
      session={session}
      participants={participants}
      me={me}
      companyName={org?.name ?? "The company"}
      candidateEmail={candidate?.email ?? null}
      emailEnabled={staffView && isEmailConfigured()}
      events={events.filter((e) => e.seq <= session.last_seq)}
      privateNotes={privateNotes}
      guide={guide}
      serverNow={new Date().toISOString()}
    />
  );
}

function JoinGate({
  sessionId,
  title,
  status,
  participants,
  viewerId,
}: {
  sessionId: string;
  title: string;
  status: string;
  participants: { user_id: string | null; role: string; display_name: string; joined_at: string | null }[];
  viewerId: string;
}) {
  if (status === "cancelled") {
    return (
      <div className="page-narrow grid gap-4 py-14">
        <h1 className="text-[2rem]!">This interview was cancelled</h1>
        <Link href="/interview" className="link">
          All interviews
        </Link>
      </div>
    );
  }
  const interviewers = participants.filter((p) => p.role === "interviewer");
  const assigned = interviewers.some((p) => p.user_id === viewerId);
  const full = interviewers.filter((p) => p.joined_at).length >= 2;
  return (
    <div className="page-narrow grid gap-6 py-14">
      <header className="grid gap-2">
        <p className="faint">{status === "in_progress" ? "In progress" : "Scheduled"}</p>
        <h1 className="text-[2rem]!">{title}</h1>
        <p className="lede">
          {assigned ? "You're an interviewer on this one." : "You're not assigned to this interview."} Interviewers:{" "}
          {interviewers.map((p) => `${p.display_name}${p.joined_at ? "" : " (not joined)"}`).join(", ") || "none yet"}.
        </p>
      </header>
      {full && !assigned ? (
        <p className="muted">Two interviewers are already in the room. You can read the review once it ends.</p>
      ) : (
        <div className="panel grid gap-4">
          <ul className="grid gap-1.5 text-[0.95rem]">
            <li>You&apos;ll get the interviewer guide: hidden requirements, numbers, follow-up questions and the rubric.</li>
            <li>Interviewers run the clock. Send the candidate their link from the lobby when you&apos;re ready.</li>
            <li>Afterwards you write a scorecard on your own. Others&apos; scorecards unlock when you submit yours.</li>
          </ul>
          <InterviewerJoinForm sessionId={sessionId} assigned={assigned} />
        </div>
      )}
    </div>
  );
}
