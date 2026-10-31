import "server-only";

// Google Calendar over its REST API (ADR 0013). Scope: calendar.events only. Events are
// created on the scheduler's primary calendar with every attendee invited and a Meet link;
// Google sends the invitations and updates.

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
export const GOOGLE_SCOPES = ["openid", "email", "https://www.googleapis.com/auth/calendar.events"];

export const isGoogleCalendarConfigured = () =>
  Boolean(process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim() && process.env.CALENDAR_TOKEN_KEY?.trim());

export class GoogleCalendarError extends Error {
  constructor(
    message: string,
    readonly reconnect = false,
  ) {
    super(message);
  }
}

export function authorizeUrl(redirectUri: string, state: string) {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH_URL}?${params}`;
}

async function token(body: Record<string, string>) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, ...body }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    // invalid_grant: the user revoked access or the token expired.
    throw new GoogleCalendarError("Google Calendar access was lost. Reconnect it from your account page.", data.error === "invalid_grant");
  }
  return data;
}

/** Exchange the OAuth code. Returns the refresh token and the Google account's email. */
export async function exchangeCode(code: string, redirectUri: string) {
  const data = await token({ code, redirect_uri: redirectUri, grant_type: "authorization_code" });
  const refresh = typeof data.refresh_token === "string" ? data.refresh_token : null;
  if (!refresh) throw new GoogleCalendarError("Google didn't return offline access. Try connecting again.");
  const scopes = String(data.scope ?? "").split(" ");
  if (!scopes.includes("https://www.googleapis.com/auth/calendar.events")) {
    throw new GoogleCalendarError("Calendar access wasn't granted. Tick the calendar permission when connecting.");
  }
  let email: string | null = null;
  const info = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { authorization: `Bearer ${String(data.access_token)}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (info.ok) email = ((await info.json()) as { email?: string }).email ?? null;
  return { refreshToken: refresh, email };
}

async function accessToken(refreshToken: string) {
  const data = await token({ refresh_token: refreshToken, grant_type: "refresh_token" });
  return String(data.access_token);
}

export type GoogleEventInput = {
  requestId: string;
  summary: string;
  description: string;
  start: Date;
  minutes: number;
  attendees: string[];
  withMeet: boolean;
};

export async function createEvent(refreshToken: string, e: GoogleEventInput) {
  const at = await accessToken(refreshToken);
  const res = await fetch(`${API}?conferenceDataVersion=1&sendUpdates=all`, {
    method: "POST",
    headers: { authorization: `Bearer ${at}`, "content-type": "application/json" },
    body: JSON.stringify({
      summary: e.summary,
      description: e.description,
      start: { dateTime: e.start.toISOString() },
      end: { dateTime: new Date(e.start.getTime() + e.minutes * 60_000).toISOString() },
      attendees: [...new Set(e.attendees)].map((email) => ({ email })),
      guestsCanSeeOtherGuests: false,
      conferenceData: e.withMeet
        ? { createRequest: { requestId: e.requestId, conferenceSolutionKey: { type: "hangoutsMeet" } } }
        : undefined,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    console.error("google createEvent failed", res.status, (await res.text()).slice(0, 300));
    throw new GoogleCalendarError("Google Calendar didn't accept the event.", res.status === 401 || res.status === 403);
  }
  const data = (await res.json()) as { id: string; hangoutLink?: string };
  return { id: data.id, meetingUrl: data.hangoutLink ?? null };
}

export async function deleteEvent(refreshToken: string, eventId: string) {
  const at = await accessToken(refreshToken);
  const res = await fetch(`${API}/${encodeURIComponent(eventId)}?sendUpdates=all`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${at}` },
    signal: AbortSignal.timeout(15_000),
  });
  // 404/410: already gone, which is what we wanted.
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    throw new GoogleCalendarError("Couldn't remove the Google Calendar event.");
  }
}

export async function revoke(refreshToken: string) {
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refreshToken)}`, {
    method: "POST",
    signal: AbortSignal.timeout(10_000),
  }).catch(() => undefined);
}
