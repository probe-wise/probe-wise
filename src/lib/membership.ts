import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { headers } from "next/headers";
import type { Database } from "@/lib/database.types";
import { configuredSiteUrl } from "@/lib/env";
import { isWorkspaceFreePath } from "@/lib/routes";
import { safeNextPath } from "@/lib/safe-redirect";

/**
 * Run right after a successful sign-in: decides where the user lands. People without
 * a workspace create one first, unless they're on their way to accept a team invite.
 */
export async function routeAfterSignIn(supabase: SupabaseClient<Database>, next: string | null | undefined) {
  const destination = safeNextPath(next);
  if (isWorkspaceFreePath(destination)) return destination;
  const { data: member } = await supabase.from("org_members").select("org_id").maybeSingle();
  return member ? destination : "/onboarding";
}

/**
 * Origin used to build email/OAuth redirect URLs and invite links. Prefer
 * NEXT_PUBLIC_SITE_URL in production so a spoofed Host header can't redirect links elsewhere
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
