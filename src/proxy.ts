import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseEnv } from "@/lib/env";
import { isGuestOnlyPath, isProtectedPath } from "@/lib/routes";
import { DEFAULT_AFTER_LOGIN, safeNextPath } from "@/lib/safe-redirect";

/**
 * Runs before every page request:
 *  1. Refreshes the Supabase session cookie (required by @supabase/ssr).
 *  2. Sends signed-out visitors away from protected pages to /login?next=…
 *  3. Sends signed-in visitors away from /login.
 * Membership (seat / waitlist / onboarding) is checked in the pages themselves,
 * because it needs a database read.
 */
export async function proxy(request: NextRequest) {
  const env = getSupabaseEnv();
  // Not configured yet (e.g. first local run): let pages render their setup notice.
  if (!env) return NextResponse.next({ request });

  let response = NextResponse.next({ request });

  const supabase = createServerClient(env.url, env.key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        // Cache-control headers that stop CDNs from caching a response that sets auth cookies.
        for (const [key, value] of Object.entries(headers ?? {})) response.headers.set(key, value);
      },
    },
  });

  // Do not run code between createServerClient and getClaims(): it validates the JWT
  // and refreshes the session when needed.
  let signedIn = false;
  try {
    const { data } = await supabase.auth.getClaims();
    signedIn = Boolean(data?.claims?.sub);
  } catch {
    signedIn = false; // Auth service unreachable → treat as signed out rather than 500.
  }

  const { pathname, search } = request.nextUrl;

  const redirectTo = (path: string) => {
    const url = request.nextUrl.clone();
    const [p, q] = path.split("?");
    url.pathname = p;
    url.search = q ? `?${q}` : "";
    const redirect = NextResponse.redirect(url);
    // Keep any refreshed auth cookies on the redirect response.
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    return redirect;
  };

  if (!signedIn && isProtectedPath(pathname)) {
    return redirectTo(`/login?next=${encodeURIComponent(pathname + search)}`);
  }

  if (signedIn && isGuestOnlyPath(pathname)) {
    return redirectTo(safeNextPath(request.nextUrl.searchParams.get("next"), DEFAULT_AFTER_LOGIN));
  }

  return response;
}

export const config = {
  matcher: [
    // Everything except static assets and image optimisation.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml)$).*)",
  ],
};
