import { NextResponse } from "next/server";
import { getViewer } from "@/lib/dal";
import { getEvaluations, getSessionEvents, getSessionView, verifySessionLog } from "@/lib/interview/session-dal";

// Full session record as JSON, for the participant's own archive or offline analysis.
// Runs as the requesting user, so RLS applies: a candidate's export never contains
// interviewers' private notes, and unreleased scorecards are left out.

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await getViewer())) return NextResponse.json({ error: "Sign in to export this session." }, { status: 401 });
  const view = await getSessionView(id);
  if (!view) return NextResponse.json({ error: "Session not found." }, { status: 404 });

  const [events, evaluations, integrity] = await Promise.all([
    getSessionEvents(id),
    getEvaluations(id),
    verifySessionLog(id),
  ]);
  const { session, participants, me } = view;

  const body = {
    format: "probewise.session.v1",
    exported_at: new Date().toISOString(),
    exported_by: { participant_id: me.id, role: me.role },
    integrity,
    session: {
      id: session.id,
      mode: session.mode,
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
  };

  return new NextResponse(JSON.stringify(body, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="probewise-session-${session.id}.json"`,
      "cache-control": "private, no-store",
    },
  });
}
