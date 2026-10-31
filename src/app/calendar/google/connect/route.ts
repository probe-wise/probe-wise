import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { authorizeUrl, isGoogleCalendarConfigured } from "@/lib/calendar/google";
import { getMembership, getViewer } from "@/lib/dal";
import { requestOrigin } from "@/lib/membership";

const STATE_COOKIE = "pw_gcal_state";

// Starts "Connect Google Calendar": a random state in an httpOnly cookie, then Google's consent screen.
export async function GET() {
  const origin = await requestOrigin();
  const viewer = await getViewer();
  if (!viewer || viewer.anonymous) return NextResponse.redirect(new URL("/login?next=/account", origin));
  if (!(await getMembership())) return NextResponse.redirect(new URL("/onboarding", origin));
  if (!isGoogleCalendarConfigured()) return NextResponse.redirect(new URL("/account?calendar=unavailable", origin));

  const state = randomBytes(24).toString("base64url");
  (await cookies()).set(STATE_COOKIE, `${state}.${viewer.id}`, {
    httpOnly: true,
    secure: origin.startsWith("https://"),
    sameSite: "lax",
    path: "/calendar/google",
    maxAge: 600,
  });
  return NextResponse.redirect(authorizeUrl(`${origin}/calendar/google/callback`, state));
}
