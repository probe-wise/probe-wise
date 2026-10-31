import { NextResponse } from "next/server";
import { interviewIcs } from "@/lib/calendar";
import { getViewer } from "@/lib/dal";
import { getSessionView } from "@/lib/interview/session-dal";

// A calendar file for one interview, for the hiring team (works with any calendar app).
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await getViewer();
  if (!viewer || viewer.anonymous) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const view = await getSessionView(id);
  if (!view?.isStaff) return NextResponse.json({ error: "Interview not found." }, { status: 404 });
  const ics = await interviewIcs(id, viewer.id);
  if (!ics) return NextResponse.json({ error: "This interview has no time set." }, { status: 404 });
  return new NextResponse(ics, {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": `attachment; filename="interview-${id}.ics"`,
      "cache-control": "private, no-store",
    },
  });
}
