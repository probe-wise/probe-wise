import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { authErrorCode, callbackErrorCode } from "@/lib/auth-errors";
import { configuredSiteUrl, isSupabaseConfigured } from "@/lib/env";
import { claimSeatAndRoute } from "@/lib/membership";
import { safeNextPath } from "@/lib/safe-redirect";
import { createClient } from "@/lib/supabase/server";

const EMAIL_OTP_TYPES: EmailOtpType[] = ["email", "magiclink", "signup", "invite", "recovery", "email_change"];

/**
 * Magic-link landing route. Supports both:
 *  - ?token_hash=…&type=email  (recommended email template; works across devices)
 *  - ?code=…                   (Supabase's default template with PKCE; same browser only)
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const origin = configuredSiteUrl() ?? request.nextUrl.origin;
  const next = safeNextPath(params.get("next"));
  const toLogin = (code: string) =>
    NextResponse.redirect(new URL(`/login?error=${code}&next=${encodeURIComponent(next)}`, origin));

  if (!isSupabaseConfigured()) return toLogin("not_configured");

  const linkError = callbackErrorCode(params);
  if (linkError) return toLogin(linkError);

  const supabase = await createClient();
  const tokenHash = params.get("token_hash");
  const type = params.get("type") as EmailOtpType | null;
  const code = params.get("code");

  if (tokenHash && type && EMAIL_OTP_TYPES.includes(type)) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (error) return toLogin(authErrorCode(error));
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return toLogin(authErrorCode(error));
  } else {
    return toLogin("missing_code");
  }

  const destination = await claimSeatAndRoute(supabase, next);
  return NextResponse.redirect(new URL(destination, origin));
}
