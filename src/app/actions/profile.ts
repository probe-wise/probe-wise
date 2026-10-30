"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { getMyProfile, getViewer } from "@/lib/dal";
import { claimSeatAndRoute } from "@/lib/membership";
import { parseProfileForm, type ProfileFieldName } from "@/lib/profile-schema";
import { createClient } from "@/lib/supabase/server";

export type ProfileFormState = {
  status: "idle" | "error" | "saved";
  message?: string;
  fieldErrors?: Partial<Record<ProfileFieldName, string>>;
  savedAt?: number;
};

export type ProfileFormMode = "onboarding" | "edit";

async function saveProfile(mode: ProfileFormMode, formData: FormData): Promise<ProfileFormState> {
  // Re-authorise inside the action; never trust that the page did it.
  const viewer = await getViewer();
  if (!viewer) redirect(`/login?next=${mode === "onboarding" ? "/onboarding" : "/profile"}`);
  const profile = await getMyProfile();
  if (!profile) redirect("/waitlist");

  const parsed = parseProfileForm(formData, { existingDate: profile.interview_date });
  if (!parsed.success) {
    return { status: "error", message: "Fix the highlighted fields.", fieldErrors: parsed.fieldErrors };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .update({
      ...parsed.data,
      onboarding_completed_at: profile.onboarding_completed_at ?? new Date().toISOString(),
    })
    .eq("id", viewer.id)
    .select("id");

  if (error || !data?.length) {
    console.error("profile update failed", error);
    return { status: "error", message: "We couldn't save your profile. Please try again." };
  }

  if (mode === "onboarding") redirect("/dashboard?welcome=1");
  refresh();
  return { status: "saved", savedAt: Date.now() };
}

export async function completeOnboarding(_prev: ProfileFormState, formData: FormData) {
  return saveProfile("onboarding", formData);
}

export async function updateProfile(_prev: ProfileFormState, formData: FormData) {
  return saveProfile("edit", formData);
}

export type DeleteAccountState = { status: "idle" | "error"; message?: string };

export async function deleteAccount(_prev: DeleteAccountState, formData: FormData): Promise<DeleteAccountState> {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  if (String(formData.get("confirm") ?? "").trim() !== "DELETE") {
    return { status: "error", message: 'Type DELETE to confirm.' };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_my_account");
  if (error) {
    console.error("delete_my_account failed", error);
    return { status: "error", message: "We couldn't delete your account. Please try again." };
  }
  // The auth user is gone; clear the local session cookies (server call may 4xx — that's fine).
  await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
  redirect("/?account=deleted");
}

/** Waitlist "check again" button. */
export async function checkForSeat() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login?next=/waitlist");
  const supabase = await createClient();
  const destination = await claimSeatAndRoute(supabase, "/dashboard");
  // Tell the waitlist page the check ran, so it can say "still full" instead of looking unchanged.
  redirect(destination === "/waitlist" ? "/waitlist?checked=1" : destination);
}
