import { NextResponse, type NextRequest } from "next/server";
import { authErrorCode, callbackErrorCode } from "@/lib/auth-errors";
import { configuredSiteUrl, isSupabaseConfigured } from "@/lib/env";
import { claimSeatAndRoute } from "@/lib/membership";
import { safeNextPath } from "@/lib/safe-redirect";
import { createClient } from "@/lib/supabase/server";

// OAuth (Google / GitHub) lands here with ?code=… (PKCE) or ?error=…
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const origin = configuredSiteUrl() ?? request.nextUrl.origin;
  const next = safeNextPath(params.get("next"));
  const toLogin = (code: string) =>
    NextResponse.redirect(new URL(`/login?error=${code}&next=${encodeURIComponent(next)}`, origin));

  if (!isSupabaseConfigured()) return toLogin("not_configured");

  const providerError = callbackErrorCode(params);
  if (providerError) return toLogin(providerError);

  const code = params.get("code");
  if (!code) return toLogin("missing_code");

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return toLogin(authErrorCode(error));

  const destination = await claimSeatAndRoute(supabase, next);
  return NextResponse.redirect(new URL(destination, origin));
}
