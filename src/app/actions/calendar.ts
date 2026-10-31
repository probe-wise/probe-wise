"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { revoke } from "@/lib/calendar/google";
import { getMembership, getViewer } from "@/lib/dal";
import { open, secretKey } from "@/lib/secret-box";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import type { FormState } from "@/app/actions/org";

/** Disconnect Google Calendar: revoke the grant at Google, then forget the token. */
export async function disconnectCalendar(): Promise<FormState> {
  const viewer = await getViewer();
  if (!viewer || viewer.anonymous) redirect("/login?next=/account");
  const service = createServiceClient();
  const { data } = await service.rpc("get_calendar_connection", { p_user: viewer.id });
  const key = secretKey();
  if (data?.[0] && key) {
    try {
      await revoke(open(data[0].refresh_token_ciphertext, key));
    } catch {
      // Undecryptable or already revoked: deleting the row is what matters.
    }
  }
  await service.rpc("delete_calendar_connection", { p_user: viewer.id });
  refresh();
  return { status: "saved", savedAt: Date.now() };
}

const PROVIDERS = ["google", "ics", "none"] as const;

/** Admins choose how the workspace sends calendar invites. */
export async function setCalendarProvider(_prev: FormState, formData: FormData): Promise<FormState> {
  const membership = await getMembership();
  if (!membership) redirect("/onboarding");
  const value = String(formData.get("calendar_provider") ?? "");
  const provider = PROVIDERS.find((p) => p === value);
  if (!provider) return { status: "error", message: "Pick an option." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organizations")
    .update({ calendar_provider: provider })
    .eq("id", membership.org.id)
    .select("id");
  if (error || !data?.length) return { status: "error", message: "Only admins can change this." };
  refresh();
  return { status: "saved", savedAt: Date.now() };
}
