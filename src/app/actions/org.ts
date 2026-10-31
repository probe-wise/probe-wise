"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getMembership, getViewer } from "@/lib/dal";
import { EmailError, isEmailConfigured, sendEmail } from "@/lib/email";
import { teamInviteEmail } from "@/lib/email/templates";
import { sessionErrorMessage } from "@/lib/interview/errors";
import { generateInviteToken, hashInviteToken, isWellFormedToken } from "@/lib/interview/invite-token";
import { requestOrigin } from "@/lib/membership";
import { ORG_ROLES, type OrgRoleValue } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { cleanText } from "@/lib/text";

// Workspace and account actions. Each re-authorises; the database checks roles again.

export type FormState = { status: "idle" | "error" | "saved"; message?: string; savedAt?: number };

const roleSchema = z.enum(ORG_ROLES.map((r) => r.value) as [OrgRoleValue, ...OrgRoleValue[]]);
const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email("Enter a valid email address."));

async function requireSignedIn(next: string) {
  const viewer = await getViewer();
  if (!viewer || viewer.anonymous) redirect(`/login?next=${encodeURIComponent(next)}`);
  return viewer;
}

/** Sign-up step 2: the first person in creates the company's workspace. */
export async function createWorkspace(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireSignedIn("/onboarding");
  const company = cleanText(formData.get("company")).slice(0, 100);
  const name = cleanText(formData.get("display_name")).slice(0, 80);
  if (!company) return { status: "error", message: "Enter your company's name." };
  if (!name) return { status: "error", message: "Enter your name." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("create_organization", { p_name: company, p_display_name: name });
  if (error) {
    console.error("create_organization failed", error);
    return { status: "error", message: sessionErrorMessage(error) };
  }
  redirect("/dashboard?welcome=1");
}

export type TeamInviteState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | {
      status: "created";
      url: string;
      email: string;
      expiresAt: string;
      createdAt: number;
      emailed: boolean;
      emailError?: string;
    };

/** Admins invite a teammate. The link is shown once; only its hash is stored. */
export async function inviteTeammate(_prev: TeamInviteState, formData: FormData): Promise<TeamInviteState> {
  await requireSignedIn("/team");
  const email = emailSchema.safeParse(formData.get("email") ?? "");
  if (!email.success) return { status: "error", message: "Enter a valid email address." };
  const role = roleSchema.safeParse(formData.get("role"));
  if (!role.success) return { status: "error", message: "Pick a role." };

  const { token, hash } = generateInviteToken();
  const supabase = await createClient();
  const { data: expiresAt, error } = await supabase.rpc("create_org_invite", {
    p_email: email.data,
    p_role: role.data,
    p_token_hash: hash,
  });
  if (error || !expiresAt) return { status: "error", message: sessionErrorMessage(error) };
  refresh();
  const origin = await requestOrigin();
  const url = `${origin}/team/join/${token}`;
  const base = { status: "created" as const, url, email: email.data, expiresAt, createdAt: Date.now() };
  if (!isEmailConfigured() || formData.get("send_email") === "off") return { ...base, emailed: false };
  const membership = await getMembership();
  try {
    await sendEmail(
      teamInviteEmail({
        to: email.data,
        org: membership?.org.name ?? "your team",
        inviter: membership?.member.display_name ?? "A teammate",
        role: role.data,
        url,
        expires: expiresAt,
      }),
    );
    return { ...base, emailed: true };
  } catch (err) {
    return { ...base, emailed: false, emailError: err instanceof EmailError ? err.message : "We couldn't send the email." };
  }
}

export async function revokeTeamInvite(inviteId: string): Promise<FormState> {
  await requireSignedIn("/team");
  const supabase = await createClient();
  const { error } = await supabase.rpc("revoke_org_invite", { p_invite: inviteId });
  if (error) return { status: "error", message: sessionErrorMessage(error) };
  refresh();
  return { status: "saved", savedAt: Date.now() };
}

export async function acceptTeamInvite(_prev: FormState, formData: FormData): Promise<FormState> {
  const token = String(formData.get("token") ?? "");
  if (!isWellFormedToken(token)) return { status: "error", message: "This invite link isn't valid." };
  await requireSignedIn(`/team/join/${token}`);
  const name = cleanText(formData.get("display_name")).slice(0, 80);
  if (!name) return { status: "error", message: "Enter your name." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("accept_org_invite", { p_token_hash: hashInviteToken(token), p_display_name: name });
  if (error) return { status: "error", message: sessionErrorMessage(error) };
  redirect("/dashboard?welcome=1");
}

export async function changeMemberRole(userId: string, role: string): Promise<FormState> {
  await requireSignedIn("/team");
  const parsed = roleSchema.safeParse(role);
  if (!parsed.success) return { status: "error", message: "Unknown role." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_org_member_role", { p_user: userId, p_role: parsed.data });
  if (error) return { status: "error", message: sessionErrorMessage(error) };
  refresh();
  return { status: "saved", savedAt: Date.now() };
}

export async function removeMember(userId: string): Promise<FormState> {
  await requireSignedIn("/team");
  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_org_member", { p_user: userId });
  if (error) return { status: "error", message: sessionErrorMessage(error) };
  refresh();
  return { status: "saved", savedAt: Date.now() };
}

export async function renameWorkspace(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireSignedIn("/team");
  const membership = await getMembership();
  if (!membership) redirect("/onboarding");
  const name = cleanText(formData.get("company")).slice(0, 100);
  if (!name) return { status: "error", message: "Enter a name." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("organizations").update({ name }).eq("id", membership.org.id).select("id");
  if (error || !data?.length) return { status: "error", message: "Only admins can rename the workspace." };
  refresh();
  return { status: "saved", savedAt: Date.now() };
}

export async function updateDisplayName(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireSignedIn("/account");
  const name = cleanText(formData.get("display_name")).slice(0, 80);
  if (!name) return { status: "error", message: "Enter your name." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_my_display_name", { p_display_name: name });
  if (error) return { status: "error", message: sessionErrorMessage(error) };
  refresh();
  return { status: "saved", savedAt: Date.now() };
}

export type DeleteAccountState = { status: "idle" | "error"; message?: string };

export async function deleteAccount(_prev: DeleteAccountState, formData: FormData): Promise<DeleteAccountState> {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  if (String(formData.get("confirm") ?? "").trim() !== "DELETE") {
    return { status: "error", message: "Type DELETE to confirm." };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_my_account");
  if (error) {
    console.error("delete_my_account failed", error);
    return { status: "error", message: sessionErrorMessage(error) };
  }
  // The auth user is gone; clear the local session cookies (server call may 4xx — that's fine).
  await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
  redirect("/?account=deleted");
}
