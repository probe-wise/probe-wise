import { NextResponse } from "next/server";
import { getViewer } from "@/lib/dal";
import { getAiAssessment, getEvaluations, getSessionEvents, getSessionView, verifySessionLog } from "@/lib/interview/session-dal";

// Full interview record as JSON, for the hiring team's archive or offline analysis.
// Runs as the requesting user, so RLS applies: scorecards and the AI assessment the
// viewer can't see yet are left out. Candidates can't export.

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await getViewer())) return NextResponse.json({ error: "Sign in to export this session." }, { status: 401 });
  const view = await getSessionView(id);
  if (!view?.isStaff) return NextResponse.json({ error: "Session not found." }, { status: 404 });

  const [events, evaluations, integrity, ai] = await Promise.all([
    getSessionEvents(id),
    getEvaluations(id),
    verifySessionLog(id),
    getAiAssessment(id),
  ]);
  const { session, participants, me } = view;

  const body = {
    format: "probewise.session.v2",
    exported_at: new Date().toISOString(),
    exported_by: { participant_id: me?.id ?? null, role: me?.role ?? "member" },
    integrity,
    session: {
      id: session.id,
      candidate_id: session.candidate_id,
      scheduled_at: session.scheduled_at,
      status: session.status,
      end_reason: session.end_reason,
      problem: { slug: session.problem_slug, version: session.problem_version, title: session.problem_title, ...session.problem_snapshot },
      phase_plan_minutes: session.phase_plan,
      created_at: session.created_at,
      started_at: session.started_at,
      ended_at: session.ended_at,
      final_notes: session.notes,
      final_board: session.board,
    },
    participants: participants.map((p) => ({
      id: p.id,
      role: p.role,
      display_name: p.display_name,
      joined_at: p.joined_at,
      consented_at: p.consented_at,
    })),
    events,
    evaluations,
    ai_assessment: ai?.status === "completed" ? ai : null,
  };

  return new NextResponse(JSON.stringify(body, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="probewise-session-${session.id}.json"`,
      "cache-control": "private, no-store",
    },
  });
}
