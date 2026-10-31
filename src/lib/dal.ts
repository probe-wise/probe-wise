import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { OrgMemberRow, OrganizationRow } from "@/lib/database.types";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

// Data Access Layer: every server-side identity / workspace check goes through here.
// Proxy redirects are a convenience; these checks are the real guard.

/** `anonymous` is a candidate who joined from their link without an account. */
export type Viewer = { id: string; email: string | null; anonymous: boolean };

export const getViewer = cache(async (): Promise<Viewer | null> => {
  if (!isSupabaseConfigured()) return null;
  const supabase = await createClient();
  try {
    const { data, error } = await supabase.auth.getClaims();
    if (error || !data?.claims?.sub) return null;
    const email = typeof data.claims.email === "string" && data.claims.email ? data.claims.email : null;
    return { id: data.claims.sub, email, anonymous: data.claims.is_anonymous === true };
  } catch {
    return null;
  }
});

export type Membership = { member: OrgMemberRow; org: OrganizationRow };

/** The viewer's workspace and their place in it, or null (candidates, new sign-ups). */
export const getMembership = cache(async (): Promise<Membership | null> => {
  const viewer = await getViewer();
  if (!viewer || viewer.anonymous) return null;
  const supabase = await createClient();
  const { data: member, error } = await supabase.from("org_members").select("*").eq("user_id", viewer.id).maybeSingle();
  if (error) throw new Error("We couldn't load your workspace. Please refresh.");
  if (!member) return null;
  const { data: org } = await supabase.from("organizations").select("*").eq("id", member.org_id).single();
  if (!org) return null;
  return { member, org };
});

export async function requireViewer(currentPath: string): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) redirect(`/login?next=${encodeURIComponent(currentPath)}`);
  return viewer;
}

/**
 * Ensures the caller belongs to a workspace. Candidate (anonymous) sessions go to
 * /login; signed-in people without a workspace go to /onboarding to create one.
 */
export async function requireMember(currentPath: string, { admin = false } = {}) {
  const viewer = await requireViewer(currentPath);
  if (viewer.anonymous) redirect(`/login?next=${encodeURIComponent(currentPath)}`);
  const membership = await getMembership();
  if (!membership) redirect("/onboarding");
  if (admin && membership.member.role !== "admin") redirect("/dashboard");
  return { viewer, ...membership };
}
