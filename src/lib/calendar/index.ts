import "server-only";
import { buildIcs } from "@/lib/calendar/ics";
import { createEvent, deleteEvent, GoogleCalendarError, isGoogleCalendarConfigured } from "@/lib/calendar/google";
import type { InterviewSessionRow } from "@/lib/database.types";
import { isEmailConfigured, sendEmail } from "@/lib/email";
import { interviewCancelledEmail, interviewScheduledEmail } from "@/lib/email/templates";
import { getSupabaseSecretKey } from "@/lib/env";
import { roundLabel } from "@/lib/interview/rounds";
import { requestOrigin } from "@/lib/membership";
import { open, secretKey } from "@/lib/secret-box";
import { createClient, createServiceClient } from "@/lib/supabase/server";

// Getting interviews onto calendars (ADR 0013). Per workspace (organizations.calendar_provider):
//   google (default): an event on the scheduler's Google Calendar, everyone invited, Meet
//                     link attached; Google sends the invites and updates. Needs the
//                     scheduler to have connected Google; otherwise falls back to .ics.
//   ics:              an email with an .ics invite to each interviewer and the candidate.
//   none:             nothing is sent; the interview page still offers an .ics download.

export type CalendarOutcome =
  | { status: "google"; meetingUrl: string | null }
  | { status: "ics_emailed"; recipients: number }
  | { status: "skipped"; reason: string }
  | { status: "failed"; reason: string };

type Context = {
  session: InterviewSessionRow;
  org: { name: string; calendar_provider: string };
  candidate: { full_name: string; email: string | null } | null;
  interviewers: { user_id: string; display_name: string; email: string | null }[];
  organizer: { display_name: string; email: string | null } | null;
  minutes: number;
};

/** Reads everything as the signed-in user, so RLS still decides what they can touch. */
async function loadContext(sessionId: string, actorId: string): Promise<Context | null> {
  const supabase = await createClient();
  const { data: session } = await supabase.from("interview_sessions").select("*").eq("id", sessionId).maybeSingle();
  if (!session) return null;
  const [{ data: org }, { data: candidate }, { data: participants }, { data: members }] = await Promise.all([
    supabase.from("organizations").select("name, calendar_provider").eq("id", session.org_id).single(),
    supabase.from("candidates").select("full_name, email").eq("id", session.candidate_id).maybeSingle(),
    supabase.from("session_participants").select("user_id, role").eq("session_id", sessionId).eq("role", "interviewer"),
    supabase.from("org_members").select("user_id, display_name, email").eq("org_id", session.org_id),
  ]);
  if (!org) return null;
  const ids = new Set((participants ?? []).map((p) => p.user_id));
  const minutes = Object.values(session.phase_plan as Record<string, number>).reduce((a, b) => a + b, 0);
  return {
    session,
    org,
    candidate,
    interviewers: (members ?? []).filter((m) => ids.has(m.user_id)),
    organizer: (members ?? []).find((m) => m.user_id === actorId) ?? null,
    minutes,
  };
}

const uid = (sessionId: string) => `${sessionId}@probewise`;

function describe(ctx: Context, roomUrl: string) {
  const round = roundLabel(ctx.session.round_type);
  return {
    summary: `${round} interview: ${ctx.candidate?.full_name ?? "Candidate"} · ${ctx.org.name}`,
    description: [
      `${round} interview with ${ctx.org.name}.`,
      "Candidate: your interviewer sends you a link to the interview room when it starts. No account needed.",
      `Interviewers: open the room a few minutes early and send the candidate's link from the lobby: ${roomUrl}`,
    ].join("\n\n"),
  };
}

function inviteIcs(ctx: Context, method: "REQUEST" | "CANCEL", roomUrl: string) {
  const { summary, description } = describe(ctx, roomUrl);
  const attendees = [
    ...ctx.interviewers.filter((i) => i.email).map((i) => ({ name: i.display_name, email: i.email! })),
    ...(ctx.candidate?.email ? [{ name: ctx.candidate.full_name, email: ctx.candidate.email }] : []),
  ];
  return buildIcs({
    uid: uid(ctx.session.id),
    sequence: method === "CANCEL" ? 1 : 0,
    method,
    start: new Date(ctx.session.scheduled_at!),
    minutes: ctx.minutes,
    summary,
    description,
    url: roomUrl,
    organizer: {
      name: ctx.organizer?.display_name ?? ctx.org.name,
      email: ctx.organizer?.email ?? process.env.EMAIL_FROM?.match(/<([^>]+)>/)?.[1] ?? "no-reply@probewise.app",
    },
    attendees,
  });
}

async function googleToken(userId: string) {
  const key = secretKey();
  if (!isGoogleCalendarConfigured() || !key || !getSupabaseSecretKey()) return null;
  const { data } = await createServiceClient().rpc("get_calendar_connection", { p_user: userId });
  const row = data?.[0];
  if (!row) return null;
  try {
    return open(row.refresh_token_ciphertext, key);
  } catch {
    return null; // key rotated: the user has to reconnect
  }
}

async function emailIcs(ctx: Context, roomUrl: string): Promise<CalendarOutcome> {
  if (!isEmailConfigured()) return { status: "skipped", reason: "Email isn't set up, so no invites were sent. Download the .ics from the interview page." };
  const ics = inviteIcs(ctx, "REQUEST", roomUrl);
  const start = ctx.session.scheduled_at!;
  const title = roundLabel(ctx.session.round_type);
  const candidateName = ctx.candidate?.full_name ?? "the candidate";
  const staff = ctx.interviewers.map((i) => i.email).filter((e): e is string => Boolean(e));
  let sent = 0;
  if (staff.length) {
    await sendEmail(interviewScheduledEmail({ to: staff, org: ctx.org.name, title, start, minutes: ctx.minutes, forCandidate: false, candidateName, roomUrl, ics }));
    sent += staff.length;
  }
  if (ctx.candidate?.email) {
    await sendEmail(interviewScheduledEmail({ to: [ctx.candidate.email], org: ctx.org.name, title, start, minutes: ctx.minutes, forCandidate: true, candidateName, ics }));
    sent += 1;
  }
  return { status: "ics_emailed", recipients: sent };
}

/** Called after scheduling. Never throws: scheduling succeeded either way. */
export async function inviteForInterview(sessionId: string, actorId: string): Promise<CalendarOutcome> {
  try {
    const ctx = await loadContext(sessionId, actorId);
    if (!ctx) return { status: "failed", reason: "Couldn't load the interview." };
    if (!ctx.session.scheduled_at) return { status: "skipped", reason: "No time was set, so no calendar invites were sent." };
    if (ctx.org.calendar_provider === "none") return { status: "skipped", reason: "Calendar invites are turned off for this workspace." };
    const roomUrl = `${await requestOrigin()}/interview/${sessionId}`;

    if (ctx.org.calendar_provider === "google") {
      const refresh = await googleToken(actorId);
      if (refresh) {
        const { summary, description } = describe(ctx, roomUrl);
        const event = await createEvent(refresh, {
          requestId: sessionId,
          summary,
          description,
          start: new Date(ctx.session.scheduled_at),
          minutes: ctx.minutes,
          attendees: [...ctx.interviewers.map((i) => i.email), ctx.candidate?.email].filter((e): e is string => Boolean(e)),
          withMeet: true,
        });
        await createServiceClient().rpc("set_session_calendar", {
          p_session: sessionId,
          p_owner: actorId,
          p_event_id: event.id,
          p_meeting_url: event.meetingUrl,
        });
        return { status: "google", meetingUrl: event.meetingUrl };
      }
      // Not connected (or Google isn't set up for this deployment): send .ics instead.
    }
    return await emailIcs(ctx, roomUrl);
  } catch (err) {
    console.error("calendar invite failed", err);
    const reason = err instanceof GoogleCalendarError || err instanceof Error ? err.message : "Calendar invite failed.";
    return { status: "failed", reason };
  }
}

/** Called when an interview is cancelled from the lobby. Never throws. */
export async function cancelInterviewInvite(sessionId: string, actorId: string) {
  try {
    const ctx = await loadContext(sessionId, actorId);
    if (!ctx?.session.scheduled_at) return;
    if (ctx.session.calendar_event_id && ctx.session.calendar_owner) {
      const refresh = await googleToken(ctx.session.calendar_owner);
      if (refresh) await deleteEvent(refresh, ctx.session.calendar_event_id);
      return;
    }
    if (ctx.org.calendar_provider === "none" || !isEmailConfigured()) return;
    const roomUrl = `${await requestOrigin()}/interview/${sessionId}`;
    const ics = inviteIcs(ctx, "CANCEL", roomUrl);
    const to = [...ctx.interviewers.map((i) => i.email), ctx.candidate?.email].filter((e): e is string => Boolean(e));
    if (to.length) {
      await sendEmail(interviewCancelledEmail({ to, org: ctx.org.name, title: roundLabel(ctx.session.round_type), start: ctx.session.scheduled_at, ics }));
    }
  } catch (err) {
    console.error("calendar cancel failed", err);
  }
}

/** The .ics for one interview, for the download link. Null when it has no time. */
export async function interviewIcs(sessionId: string, actorId: string) {
  const ctx = await loadContext(sessionId, actorId);
  if (!ctx?.session.scheduled_at) return null;
  return inviteIcs(ctx, ctx.session.status === "cancelled" ? "CANCEL" : "REQUEST", `${await requestOrigin()}/interview/${sessionId}`);
}
