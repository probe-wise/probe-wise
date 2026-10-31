"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { cancelInterviewInvite } from "@/lib/calendar";
import { getMembership, getViewer } from "@/lib/dal";
import { EmailError, isEmailConfigured, sendEmail } from "@/lib/email";
import { candidateLinkEmail } from "@/lib/email/templates";
import { isAiAssessmentConfigured } from "@/lib/env";
import { AiAssessmentError, generateAssessment } from "@/lib/interview/ai-assessment";
import { sessionErrorMessage } from "@/lib/interview/errors";
import { generateInviteToken, hashInviteToken, isWellFormedToken } from "@/lib/interview/invite-token";
import { evaluationSchema, type EvaluationInput } from "@/lib/interview/rubric";
import { getSessionCandidate, getSessionEvents, getSessionView } from "@/lib/interview/session-dal";
import { requestOrigin } from "@/lib/membership";
import { loadProblem } from "@/lib/problems/problem-source";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { cleanText } from "@/lib/text";

// Out-of-room session flows. In-room actions (start, phase, end, record) are RPCs the
// browser calls directly: the database authorises them itself and they need low latency.
// Every action here re-authorises; none trusts the page that rendered the form.

export type ActionState = { status: "idle" | "error"; message?: string };

const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);

export type LinkState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | {
      status: "created";
      url: string;
      expiresAt: string;
      createdAt: number;
      /** Set when it was emailed to the candidate; `emailError` when that failed. */
      emailedTo?: string;
      emailError?: string;
    };

/**
 * A one-time link for the candidate. The token is shown once and never stored in clear.
 * With `email`, it's also sent to the candidate's address on their record.
 */
export async function createCandidateLink(sessionId: string, { email = false } = {}): Promise<LinkState> {
  if (!isUuid(sessionId)) return { status: "error", message: "Unknown session." };
  const viewer = await getViewer();
  if (!viewer || viewer.anonymous) return { status: "error", message: "Your session expired. Sign in again." };

  const { token, hash } = generateInviteToken();
  const supabase = await createClient();
  const { data: expiresAt, error } = await supabase.rpc("create_candidate_link", { p_session: sessionId, p_token_hash: hash });
  if (error || !expiresAt) {
    console.error("create_candidate_link failed", error);
    return { status: "error", message: sessionErrorMessage(error) };
  }
  const origin = await requestOrigin();
  const created = { status: "created" as const, url: `${origin}/join/${token}`, expiresAt, createdAt: Date.now() };
  if (!email) return created;

  const view = await getSessionView(sessionId);
  const candidate = view ? await getSessionCandidate(view.session.candidate_id) : null;
  if (!view || !candidate?.email) return { ...created, emailError: "The candidate has no email address on their record." };
  if (!isEmailConfigured()) return { ...created, emailError: "Email isn't set up. Copy the link instead." };
  const membership = await getMembership();
  try {
    await sendEmail(
      candidateLinkEmail({
        to: candidate.email,
        org: membership?.org.name ?? "the hiring team",
        name: candidate.full_name.split(" ")[0],
        url: created.url,
        expires: expiresAt,
        interviewer: membership?.member.display_name ?? "Your interviewer",
      }),
    );
  } catch (err) {
    return { ...created, emailError: err instanceof EmailError ? err.message : "We couldn't send the email." };
  }
  return { ...created, emailedTo: candidate.email };
}

export async function revokeCandidateLinks(sessionId: string): Promise<ActionState> {
  if (!isUuid(sessionId)) return { status: "error", message: "Unknown session." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("revoke_candidate_links", { p_session: sessionId });
  if (error) return { status: "error", message: sessionErrorMessage(error) };
  return { status: "idle" };
}

/**
 * The candidate joins from their link. They don't need an account: if they aren't
 * signed in, they get an anonymous Supabase session, which only works for this room.
 */
export async function joinAsCandidate(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const token = String(formData.get("token") ?? "");
  if (!isWellFormedToken(token)) return { status: "error", message: "This link isn't valid." };
  const name = cleanText(formData.get("display_name")).slice(0, 80);
  if (!name) return { status: "error", message: "Enter your name." };
  if (formData.get("consent") !== "on") {
    return { status: "error", message: "Tick the box to agree to the interview being recorded." };
  }

  const supabase = await createClient();
  if (!(await getViewer())) {
    const { error } = await supabase.auth.signInAnonymously();
    if (error) {
      console.error("signInAnonymously failed", error);
      return {
        status: "error",
        message: "We couldn't start your session. If this keeps happening, ask your interviewer for help.",
      };
    }
  }
  const { data: sessionId, error } = await supabase.rpc("accept_candidate_link", {
    p_token_hash: hashInviteToken(token),
    p_display_name: name,
    p_consent: true,
  });
  if (error || !sessionId) return { status: "error", message: sessionErrorMessage(error) };
  redirect(`/interview/${sessionId}`);
}

/** A teammate enters the room as an interviewer (consent is recorded). */
export async function joinAsInterviewer(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const sessionId = String(formData.get("session") ?? "");
  if (!isUuid(sessionId)) return { status: "error", message: "Unknown session." };
  const viewer = await getViewer();
  if (!viewer || viewer.anonymous) redirect(`/login?next=${encodeURIComponent(`/interview/${sessionId}`)}`);
  if (formData.get("consent") !== "on") {
    return { status: "error", message: "Tick the box to agree to the interview being recorded." };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("join_session", { p_session: sessionId, p_consent: true });
  if (error) return { status: "error", message: sessionErrorMessage(error) };
  refresh();
  return { status: "idle" };
}

/** Cancel an interview that hasn't started, and withdraw its calendar invite. */
export async function cancelInterview(sessionId: string): Promise<ActionState> {
  if (!isUuid(sessionId)) return { status: "error", message: "Unknown session." };
  const viewer = await getViewer();
  if (!viewer || viewer.anonymous) return { status: "error", message: "Your session expired. Sign in again." };
  const supabase = await createClient();
  const { data: reason, error } = await supabase.rpc("end_session", { p_session: sessionId });
  if (error) return { status: "error", message: sessionErrorMessage(error) };
  if (reason === "cancelled") await cancelInterviewInvite(sessionId, viewer.id);
  refresh();
  return { status: "idle" };
}

export type EvaluationState = {
  status: "idle" | "error" | "saved" | "submitted";
  message?: string;
  fieldErrors?: Record<string, string>;
  savedAt?: number;
};

/** Save a draft or submit a scorecard. Validated here and again in SQL. */
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
    p_recommendation: v.recommendation,
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

export type AiState = { status: "idle" | "error" | "done"; message?: string };

/**
 * Generate the advisory AI assessment (ADR 0009). The viewer's own client authorises
 * the request and reads the record (RLS); only the result is written with the service
 * key, so clients can't forge one.
 */
export async function requestAiAssessment(sessionId: string): Promise<AiState> {
  if (!isUuid(sessionId)) return { status: "error", message: "Unknown session." };
  const viewer = await getViewer();
  if (!viewer || viewer.anonymous) return { status: "error", message: "Your session expired. Sign in again." };
  if (!isAiAssessmentConfigured()) {
    return { status: "error", message: "AI assessment isn't set up. Add ANTHROPIC_API_KEY and SUPABASE_SECRET_KEY." };
  }
  const view = await getSessionView(sessionId);
  if (!view?.isStaff) return { status: "error", message: "Only the hiring team can request an AI assessment." };
  if (view.session.status !== "completed") return { status: "error", message: "Wait until the interview has ended." };

  const service = createServiceClient();
  const begin = await service.rpc("begin_ai_assessment", { p_session: sessionId, p_requested_by: viewer.id });
  if (begin.error) return { status: "error", message: sessionErrorMessage(begin.error) };

  try {
    const [events, candidate, problem] = await Promise.all([
      getSessionEvents(sessionId, { includeBoard: false }),
      getSessionCandidate(view.session.candidate_id),
      loadProblem(view.session.problem_slug),
    ]);
    const result = await generateAssessment({
      session: view.session,
      candidate: { role_title: candidate?.role_title ?? null, seniority: candidate?.seniority ?? null },
      // Independence: no private notes or scorecard events go to the model.
      events: events.filter((e) => e.visibility === "all"),
      problem,
    });
    const { error } = await service.rpc("complete_ai_assessment", {
      p_session: sessionId,
      p_model: result.model,
      p_scores: result.scores,
      p_recommendation: result.recommendation,
      p_summary: result.summary,
      p_strengths: result.strengths,
      p_concerns: result.concerns,
    });
    if (error) throw error;
  } catch (err) {
    const message = err instanceof AiAssessmentError ? err.message : "Something went wrong generating the assessment. Try again.";
    if (!(err instanceof AiAssessmentError)) console.error("AI assessment failed", err);
    await service.rpc("fail_ai_assessment", { p_session: sessionId, p_error: message });
    refresh();
    return { status: "error", message };
  }
  refresh();
  return { status: "done" };
}
