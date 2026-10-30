"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { getMyProfile, getViewer } from "@/lib/dal";
import { sessionErrorMessage } from "@/lib/interview/errors";
import { generateInviteToken, hashInviteToken, isWellFormedToken } from "@/lib/interview/invite-token";
import { phasePlanFor } from "@/lib/interview/phases";
import { evaluationSchema, type EvaluationInput } from "@/lib/interview/rubric";
import { requestOrigin } from "@/lib/membership";
import { getProblem, toPromptSnapshot } from "@/lib/problems/catalog";
import { cleanText } from "@/lib/profile-schema";
import { createClient } from "@/lib/supabase/server";

// Out-of-room session flows. In-room actions (start, phase, end, record) are RPCs the
// browser calls directly: the database authorises them itself and they need low latency.
// Every action here re-authorises; none trusts the page that rendered the form.

export type ActionState = { status: "idle" | "error"; message?: string };

const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);

/** Start a solo or peer session on a problem from the bank. */
export async function createSession(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const slug = String(formData.get("problem") ?? "");
  const viewer = await getViewer();
  if (!viewer) redirect(`/login?next=${encodeURIComponent(`/problems/${slug}`)}`);
  const profile = await getMyProfile();
  if (!profile) redirect("/waitlist");
  if (!profile.onboarding_completed_at) redirect("/onboarding");

  const problem = getProblem(slug);
  if (!problem) return { status: "error", message: "That problem doesn't exist." };
  const mode = formData.get("mode") === "peer" ? "peer" : "solo";
  if (formData.get("consent") !== "on") {
    return { status: "error", message: "Tick the box to agree to the session being recorded." };
  }

  const supabase = await createClient();
  const { data: sessionId, error } = await supabase.rpc("create_session", {
    p_mode: mode,
    p_problem_slug: problem.slug,
    p_problem_version: problem.version,
    p_problem_title: problem.title,
    p_problem_snapshot: toPromptSnapshot(problem),
    p_phase_plan: phasePlanFor(profile.seniority),
    p_display_name: profile.full_name ?? viewer.email?.split("@")[0] ?? "Candidate",
    p_consent: true,
  });
  if (error || !sessionId) {
    console.error("create_session failed", error);
    return { status: "error", message: sessionErrorMessage(error) };
  }
  redirect(`/interview/${sessionId}`);
}

export type InviteState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "created"; url: string; expiresAt: string; createdAt: number };

/** New invite link for an interviewer. The token is shown once and never stored in clear. */
export async function createInvite(sessionId: string): Promise<InviteState> {
  if (!isUuid(sessionId)) return { status: "error", message: "Unknown session." };
  if (!(await getViewer())) return { status: "error", message: "Your session expired. Sign in again." };

  const { token, hash } = generateInviteToken();
  const supabase = await createClient();
  const { data: expiresAt, error } = await supabase.rpc("create_session_invite", {
    p_session: sessionId,
    p_token_hash: hash,
  });
  if (error || !expiresAt) {
    console.error("create_session_invite failed", error);
    return { status: "error", message: sessionErrorMessage(error) };
  }
  const origin = await requestOrigin();
  return { status: "created", url: `${origin}/interview/join/${token}`, expiresAt, createdAt: Date.now() };
}

export async function revokeInvites(sessionId: string): Promise<ActionState> {
  if (!isUuid(sessionId)) return { status: "error", message: "Unknown session." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("revoke_session_invites", { p_session: sessionId });
  if (error) return { status: "error", message: sessionErrorMessage(error) };
  return { status: "idle" };
}

/** Join a session as interviewer from an invite link. */
export async function acceptInvite(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const token = String(formData.get("token") ?? "");
  if (!isWellFormedToken(token)) return { status: "error", message: "This invite link isn't valid." };
  const viewer = await getViewer();
  if (!viewer) redirect(`/login?next=${encodeURIComponent(`/interview/join/${token}`)}`);

  const name = cleanText(formData.get("display_name")).slice(0, 80);
  if (!name) return { status: "error", message: "Enter the name the candidate will see." };
  if (formData.get("consent") !== "on") {
    return { status: "error", message: "Tick the box to agree to the session being recorded." };
  }

  const supabase = await createClient();
  const { data: sessionId, error } = await supabase.rpc("accept_session_invite", {
    p_token_hash: hashInviteToken(token),
    p_display_name: name,
    p_consent: true,
  });
  if (error || !sessionId) return { status: "error", message: sessionErrorMessage(error) };
  redirect(`/interview/${sessionId}`);
}

export type EvaluationState = {
  status: "idle" | "error" | "saved" | "submitted";
  message?: string;
  fieldErrors?: Record<string, string>;
  savedAt?: number;
};

/** Save a draft or submit a scorecard / self-assessment. Validated here and again in SQL. */
export async function saveEvaluation(sessionId: string, input: EvaluationInput): Promise<EvaluationState> {
  if (!isUuid(sessionId)) return { status: "error", message: "Unknown session." };
  if (!(await getViewer())) return { status: "error", message: "Your session expired. Sign in again." };

  const parsed = evaluationSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0] ?? "form")] ??= issue.message;
    return { status: "error", message: "Fix the highlighted fields.", fieldErrors };
  }
  const v = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_evaluation", {
    p_session: sessionId,
    p_scores: v.scores,
    p_recommendation: v.kind === "scorecard" ? v.recommendation : null,
    p_summary: v.summary,
    p_submit: v.submit,
  });
  if (error) {
    console.error("save_evaluation failed", error);
    return { status: "error", message: sessionErrorMessage(error) };
  }
  if (v.submit) refresh();
  return { status: v.submit ? "submitted" : "saved", savedAt: Date.now() };
}
