// Public env vars are inlined at build time, so they must be read with literal
// `process.env.NEXT_PUBLIC_*` expressions (no dynamic lookups).

export type OAuthProvider = "google" | "github";
const KNOWN_PROVIDERS: OAuthProvider[] = ["google", "github"];

export function getSupabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  // New Supabase projects issue a "publishable" key; older ones call it the anon key.
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !key) return null;
  return { url, key };
}

export const isSupabaseConfigured = () => getSupabaseEnv() !== null;

export function requireSupabaseEnv() {
  const env = getSupabaseEnv();
  if (!env) {
    throw new Error(
      "Supabase is not configured. Copy .env.example to .env.local and set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.",
    );
  }
  return env;
}

/**
 * OAuth buttons are only shown for providers listed here, so an unconfigured
 * provider never sends users to a Supabase error page.
 * Example: NEXT_PUBLIC_AUTH_PROVIDERS="google,github"
 */
export function enabledOAuthProviders(raw = process.env.NEXT_PUBLIC_AUTH_PROVIDERS): OAuthProvider[] {
  if (!raw) return [];
  const wanted = raw
    .split(",")
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
  return KNOWN_PROVIDERS.filter((p) => wanted.includes(p));
}

/** Canonical site URL if configured (recommended in production), without trailing slash. */
export function configuredSiteUrl() {
  const raw = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Server-only secret key (sb_secret_…, or the legacy service_role key). Used for one
 * thing: writing AI assessments, which clients must not be able to forge.
 */
export function getSupabaseSecretKey() {
  return process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || null;
}

/** AI assessments need both a Claude API key and the Supabase secret key. */
export const isAiAssessmentConfigured = () =>
  Boolean(process.env.ANTHROPIC_API_KEY?.trim() && getSupabaseSecretKey() && getSupabaseEnv());
