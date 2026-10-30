import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { headers } from "next/headers";
import type { Database } from "@/lib/database.types";
import { configuredSiteUrl } from "@/lib/env";
import { safeNextPath } from "@/lib/safe-redirect";

/**
 * Run right after a successful sign-in. Claims a seat if one is free (idempotent for
 * existing members) and decides where the user should land.
 */
export async function claimSeatAndRoute(supabase: SupabaseClient<Database>, next: string | null | undefined) {
  const { data: status, error } = await supabase.rpc("claim_seat");
  if (error) {
    console.error("claim_seat failed", error);
    return "/waitlist?error=seat_check_failed";
  }
  if (status === "waitlisted") return "/waitlist";

  const { data: profile } = await supabase.from("profiles").select("onboarding_completed_at").maybeSingle();
  if (!profile?.onboarding_completed_at) return "/onboarding";
  return safeNextPath(next);
}

/**
 * Origin used to build email/OAuth redirect URLs. Prefer NEXT_PUBLIC_SITE_URL in
 * production so a spoofed Host header can't redirect magic links elsewhere
 * (Supabase also rejects URLs that aren't on its redirect allow-list).
 */
export async function requestOrigin() {
  const configured = configuredSiteUrl();
  if (configured) return configured;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
