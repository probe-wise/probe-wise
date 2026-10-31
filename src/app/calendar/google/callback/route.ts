import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { exchangeCode, GoogleCalendarError } from "@/lib/calendar/google";
import { getViewer } from "@/lib/dal";
import { requestOrigin } from "@/lib/membership";
import { seal, secretKey } from "@/lib/secret-box";
import { createServiceClient } from "@/lib/supabase/server";

const STATE_COOKIE = "pw_gcal_state";

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

// Google sends the user back here. The state must match the cookie set for this user,
// then the refresh token is encrypted and stored with the service key (ADR 0013).
export async function GET(request: NextRequest) {
  const origin = await requestOrigin();
  const back = (result: string) => NextResponse.redirect(new URL(`/account?calendar=${result}`, origin));
  const jar = await cookies();
  const stored = jar.get(STATE_COOKIE)?.value ?? "";
  jar.delete({ name: STATE_COOKIE, path: "/calendar/google" });

  const params = request.nextUrl.searchParams;
  if (params.get("error")) return back("denied");
  const code = params.get("code");
  const state = params.get("state") ?? "";
  const [expected, userId] = stored.split(".");
  const viewer = await getViewer();
  if (!code || !expected || !viewer || viewer.anonymous || viewer.id !== userId || !same(state, expected)) return back("failed");

  const key = secretKey();
  if (!key) return back("unavailable");
  try {
    const { refreshToken, email } = await exchangeCode(code, `${origin}/calendar/google/callback`);
    const { error } = await createServiceClient().rpc("save_calendar_connection", {
      p_user: viewer.id,
      p_email: email,
      p_ciphertext: seal(refreshToken, key),
    });
    if (error) throw error;
  } catch (err) {
    console.error("google calendar connect failed", err);
    return back(err instanceof GoogleCalendarError && /permission|granted/.test(err.message) ? "scope" : "failed");
  }
  return back("connected");
}
