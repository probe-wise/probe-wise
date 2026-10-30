"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { authErrorMessage } from "@/lib/auth-errors";
import { isSupabaseConfigured } from "@/lib/env";
import { claimSeatAndRoute, requestOrigin } from "@/lib/membership";
import { safeNextPath } from "@/lib/safe-redirect";
import { createClient } from "@/lib/supabase/server";

export type EmailAuthState =
  | { status: "idle" }
  | { status: "sent"; email: string; sentAt: number }
  | { status: "error"; step: "email" | "code"; email?: string; message: string; sentAt?: number };

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, "That email is too long.")
  .pipe(z.email("Enter a valid email address."));

const codeSchema = z
  .string()
  .trim()
  .transform((s) => s.replace(/\s|-/g, ""))
  .pipe(z.string().regex(/^\d{6,10}$/, "Enter the code from your email (digits only)."));

/** Step 1: email a magic link + one-time code. */
export async function sendEmailCode(_prev: EmailAuthState, formData: FormData): Promise<EmailAuthState> {
  if (!isSupabaseConfigured()) {
    return { status: "error", step: "email", message: authErrorMessage("not_configured") };
  }
  const parsed = emailSchema.safeParse(formData.get("email") ?? "");
  if (!parsed.success) {
    return { status: "error", step: "email", message: parsed.error.issues[0]?.message ?? "Enter a valid email." };
  }
  const email = parsed.data;
  const next = safeNextPath(String(formData.get("next") ?? ""));

  const supabase = await createClient();
  const origin = await requestOrigin();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: true,
      emailRedirectTo: `${origin}/auth/confirm?next=${encodeURIComponent(next)}`,
    },
  });

  const resend = formData.get("intent") === "resend";
  if (error) {
    return { status: "error", step: resend ? "code" : "email", email, message: authErrorMessage(error) };
  }
  return { status: "sent", email, sentAt: Date.now() };
}

/** Step 2 (alternative to clicking the link): type the one-time code. */
export async function verifyEmailCode(_prev: EmailAuthState, formData: FormData): Promise<EmailAuthState> {
  const email = emailSchema.safeParse(formData.get("email") ?? "");
  if (!email.success) {
    return { status: "error", step: "email", message: "Start again with your email address." };
  }
  const code = codeSchema.safeParse(formData.get("code") ?? "");
  if (!code.success) {
    return {
      status: "error",
      step: "code",
      email: email.data,
      message: code.error.issues[0]?.message ?? "Invalid code.",
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ email: email.data, token: code.data, type: "email" });
  if (error) {
    return { status: "error", step: "code", email: email.data, message: authErrorMessage(error) };
  }

  const destination = await claimSeatAndRoute(supabase, String(formData.get("next") ?? ""));
  redirect(destination);
}

export async function signOut() {
  if (isSupabaseConfigured()) {
    const supabase = await createClient();
    await supabase.auth.signOut();
  }
  redirect("/");
}
