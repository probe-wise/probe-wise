import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { InterviewRoom } from "@/components/interview/room";
import { requireViewer } from "@/lib/dal";
import { getMyInterviewerNotes, getSessionEvents, getSessionView } from "@/lib/interview/session-dal";
import { getProblem } from "@/lib/problems/catalog";

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
  await requireViewer(`/interview/${id}`);
  const view = await getSessionView(id);
  if (!view) notFound(); // not a participant looks the same as not existing
  const { session, participants, me, isController } = view;
  if (session.status === "completed") redirect(`/interview/${id}/review`);

  const isInterviewer = me.role === "interviewer";
  const [events, privateNotes] = await Promise.all([
    getSessionEvents(id, { includeBoard: false }),
    isInterviewer ? getMyInterviewerNotes(id, me.id) : Promise.resolve(""),
  ]);

  // The interviewer guide is confidential: it's only put into the page for interviewers (ADR 0004).
  const guide = isInterviewer ? (getProblem(session.problem_slug)?.guide ?? null) : null;

  return (
    <InterviewRoom
      session={session}
      participants={participants}
      me={me}
      isController={isController}
      events={events.filter((e) => e.seq <= session.last_seq)}
      privateNotes={privateNotes}
      guide={guide}
      serverNow={new Date().toISOString()}
    />
  );
}
