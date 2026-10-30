import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { ProfileRow } from "@/lib/database.types";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

// Data Access Layer: every server-side identity / membership check goes through here.
// Proxy redirects are a convenience; these checks are the real guard.

export type Viewer = { id: string; email: string | null };

export const getViewer = cache(async (): Promise<Viewer | null> => {
  if (!isSupabaseConfigured()) return null;
  const supabase = await createClient();
  try {
    const { data, error } = await supabase.auth.getClaims();
    if (error || !data?.claims?.sub) return null;
    const email = typeof data.claims.email === "string" ? data.claims.email : null;
    return { id: data.claims.sub, email };
  } catch {
    return null;
  }
});

export const getMyProfile = cache(async (): Promise<ProfileRow | null> => {
  const viewer = await getViewer();
  if (!viewer) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.from("profiles").select("*").eq("id", viewer.id).maybeSingle();
  if (error) throw new Error("We couldn't load your profile. Please refresh.");
  return data;
});

export async function requireViewer(currentPath: string): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) redirect(`/login?next=${encodeURIComponent(currentPath)}`);
  return viewer;
}

/**
 * Ensures the caller holds a seat. Users without one go to /waitlist,
 * members who haven't finished onboarding go to /onboarding.
 */
export async function requireMember(currentPath: string, { requireOnboarded = true } = {}) {
  const viewer = await requireViewer(currentPath);
  const profile = await getMyProfile();
  if (!profile) redirect("/waitlist");
  if (requireOnboarded && !profile.onboarding_completed_at) redirect("/onboarding");
  return { viewer, profile };
}
