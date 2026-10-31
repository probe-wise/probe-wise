"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getMembership, getViewer } from "@/lib/dal";
import { sessionErrorMessage } from "@/lib/interview/errors";
import { inviteForInterview, type CalendarOutcome } from "@/lib/calendar";
import { ROUNDS, ROUND_VALUES, roundLabel, roundPlanFor, type Rubric } from "@/lib/interview/rounds";
import { roundTypeOf, toPromptSnapshot } from "@/lib/problems/catalog";
import { loadProblem } from "@/lib/problems/problem-source";
import { SENIORITY_LEVELS, values } from "@/lib/profile-options";
import { createClient } from "@/lib/supabase/server";
import { cleanMultiline, cleanText } from "@/lib/text";

// Candidate records and scheduling. Candidates are rows the hiring team manages, not
// accounts; RLS scopes every read and write to the caller's workspace.

export type CandidateFormState = {
  status: "idle" | "error" | "saved";
  message?: string;
  fieldErrors?: Partial<Record<"full_name" | "email" | "role_title" | "notes", string>>;
  savedAt?: number;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const isUuid = (v: string) => UUID.test(v);

const candidateSchema = z.object({
  full_name: z.string().min(1, "Enter the candidate's name.").max(100, "Keep the name under 100 characters."),
  email: z
    .string()
    .max(254)
    .transform((v) => v.toLowerCase())
    .pipe(z.union([z.literal(""), z.email("Enter a valid email address, or leave it empty.")])),
  role_title: z.string().max(100, "Keep the role under 100 characters."),
  seniority: z.enum(values(SENIORITY_LEVELS)).nullable(),
  notes: z.string().max(5000, "Keep notes under 5,000 characters."),
});

async function requireWorkspace(next: string) {
  const viewer = await getViewer();
  if (!viewer || viewer.anonymous) redirect(`/login?next=${encodeURIComponent(next)}`);
  const membership = await getMembership();
  if (!membership) redirect("/onboarding");
  return membership;
}

/** Add a candidate, or edit one when the form carries an id. */
export async function saveCandidate(_prev: CandidateFormState, formData: FormData): Promise<CandidateFormState> {
  const id = String(formData.get("id") ?? "");
  const { org } = await requireWorkspace(id ? `/candidates/${id}` : "/candidates");
  const seniority = String(formData.get("seniority") ?? "");
  const parsed = candidateSchema.safeParse({
    full_name: cleanText(formData.get("full_name")),
    email: cleanText(formData.get("email")),
    role_title: cleanText(formData.get("role_title")),
    seniority: seniority || null,
    notes: cleanMultiline(formData.get("notes")),
  });
  if (!parsed.success) {
    const fieldErrors: CandidateFormState["fieldErrors"] = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0]) as keyof NonNullable<CandidateFormState["fieldErrors"]>;
      fieldErrors[key] ??= issue.message;
    }
    return { status: "error", message: "Fix the highlighted fields.", fieldErrors };
  }
  const v = parsed.data;
  const row = { full_name: v.full_name, email: v.email || null, role_title: v.role_title || null, seniority: v.seniority, notes: v.notes };

  const supabase = await createClient();
  if (id) {
    if (!isUuid(id)) return { status: "error", message: "Unknown candidate." };
    const { data, error } = await supabase.from("candidates").update(row).eq("id", id).select("id");
    if (error || !data?.length) return { status: "error", message: candidateError(error) };
    refresh();
    return { status: "saved", savedAt: Date.now() };
  }
  const { data, error } = await supabase.from("candidates").insert({ ...row, org_id: org.id }).select("id").single();
  if (error || !data) return { status: "error", message: candidateError(error) };
  redirect(`/candidates/${data.id}`);
}

function candidateError(error: { code?: string } | null) {
  if (error?.code === "23505") return "A candidate with that email is already in your workspace.";
  if (error) console.error("candidate write failed", error);
  return "We couldn't save the candidate. Please try again.";
}

export async function deleteCandidate(_prev: CandidateFormState, formData: FormData): Promise<CandidateFormState> {
  const id = String(formData.get("id") ?? "");
  const { member } = await requireWorkspace(`/candidates/${id}`);
  if (member.role !== "admin") return { status: "error", message: "Only admins can delete candidates." };
  if (String(formData.get("confirm") ?? "").trim() !== "DELETE") return { status: "error", message: "Type DELETE to confirm." };
  if (!isUuid(id)) return { status: "error", message: "Unknown candidate." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("candidates").delete().eq("id", id).select("id");
  if (error || !data?.length) return { status: "error", message: "We couldn't delete the candidate. Please try again." };
  redirect("/candidates?deleted=1");
}

export type ScheduleState = { status: "idle" | "error"; message?: string };

const roundSchema = z.object({
  round_type: z.enum(ROUND_VALUES),
  problem: z.string().min(1).max(80),
  /** A rubric id, or "builtin" for the round type's built-in rubric. */
  rubric: z.string().min(1).max(40),
  interviewers: z.array(z.string().regex(UUID)).min(1, "Pick one or two interviewers.").max(2, "Pick one or two interviewers."),
  scheduled_at: z.string().max(40).nullable(),
});

const scheduleSchema = z.object({
  candidate: z.string().regex(UUID),
  loop_name: z.string().trim().max(100),
  rounds: z.array(roundSchema).min(1, "Add at least one round.").max(6, "Up to 6 rounds at a time."),
});

export type RoundInput = z.infer<typeof roundSchema>;

/**
 * Schedule one round, or a loop of several (ADR 0012): each round gets a problem, a rubric
 * snapshot and its interviewers, then calendar invites go out (ADR 0013).
 */
export async function scheduleInterviews(_prev: ScheduleState, formData: FormData): Promise<ScheduleState> {
  const candidateId = String(formData.get("candidate") ?? "");
  const { member } = await requireWorkspace(`/candidates/${candidateId}`);
  let raw: unknown;
  try {
    raw = JSON.parse(String(formData.get("rounds") ?? "[]"));
  } catch {
    return { status: "error", message: "Something went wrong with the form. Reload and try again." };
  }
  const parsed = scheduleSchema.safeParse({ candidate: candidateId, loop_name: cleanText(formData.get("loop_name")), rounds: raw });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the rounds." };
  const { rounds, loop_name } = parsed.data;

  const supabase = await createClient();
  const { data: candidate } = await supabase.from("candidates").select("id, org_id, seniority, full_name").eq("id", candidateId).maybeSingle();
  if (!candidate) return { status: "error", message: "Unknown candidate." };

  // Resolve every round before creating anything, so a bad round doesn't leave half a loop.
  const prepared = [];
  for (const [i, r] of rounds.entries()) {
    const n = rounds.length > 1 ? `Round ${i + 1}: ` : "";
    const problem = await loadProblem(r.problem);
    if (!problem || roundTypeOf(problem) !== r.round_type) return { status: "error", message: `${n}pick a ${roundLabel(r.round_type).toLowerCase()} problem.` };
    let rubric: Rubric;
    if (r.rubric === "builtin") {
      rubric = ROUNDS[r.round_type].rubric;
    } else {
      if (!UUID.test(r.rubric)) return { status: "error", message: `${n}unknown rubric.` };
      const { data } = await supabase.from("rubrics").select("name, aspects, round_type, archived_at").eq("id", r.rubric).maybeSingle();
      if (!data || data.archived_at || data.round_type !== r.round_type) return { status: "error", message: `${n}that rubric isn't available.` };
      rubric = { name: data.name, aspects: data.aspects };
    }
    const when = r.scheduled_at ? new Date(r.scheduled_at) : null;
    if (when && Number.isNaN(when.getTime())) return { status: "error", message: `${n}that date doesn't look right.` };
    prepared.push({ ...r, problem, rubric, when });
  }

  let loopId: string | null = null;
  if (rounds.length > 1 || loop_name) {
    const { data: loop, error } = await supabase
      .from("interview_loops")
      .insert({ org_id: candidate.org_id, candidate_id: candidate.id, name: loop_name || `${candidate.full_name}: interview loop` })
      .select("id")
      .single();
    if (error || !loop) return { status: "error", message: "We couldn't create the loop. Please try again." };
    loopId = loop.id;
  }

  const created: string[] = [];
  for (const r of prepared) {
    const { data: sessionId, error } = await supabase.rpc("create_session", {
      p_candidate: candidateId,
      p_round_type: r.round_type,
      p_problem_slug: r.problem.slug,
      p_problem_id: r.problem.id ?? null,
      p_problem_version: r.problem.version,
      p_problem_title: r.problem.title,
      p_problem_snapshot: toPromptSnapshot(r.problem),
      p_phase_plan: roundPlanFor(r.round_type, candidate.seniority),
      p_rubric: r.rubric,
      p_interviewers: r.interviewers,
      p_scheduled_at: r.when?.toISOString() ?? null,
      p_loop: loopId,
    });
    if (error || !sessionId) {
      console.error("create_session failed", error);
      const done = created.length ? ` ${created.length} round${created.length === 1 ? " was" : "s were"} scheduled before this one.` : "";
      return { status: "error", message: `${sessionErrorMessage(error)}${done}` };
    }
    created.push(sessionId);
  }

  const outcomes = await Promise.all(created.map((id) => inviteForInterview(id, member.user_id)));
  const calendar = summarizeOutcomes(outcomes);
  const query = new URLSearchParams({ scheduled: String(created.length), calendar: calendar.status });
  if (calendar.message) query.set("calendar_note", calendar.message);
  redirect(loopId ? `/loops/${loopId}?${query}` : `/candidates/${candidateId}?${query}`);
}

function summarizeOutcomes(outcomes: CalendarOutcome[]) {
  if (outcomes.every((o) => o.status === "google")) return { status: "google" };
  if (outcomes.every((o) => o.status === "ics_emailed")) return { status: "ics" };
  const problem = outcomes.find((o) => o.status === "failed" || o.status === "skipped");
  const reason = problem && "reason" in problem ? problem.reason : undefined;
  return { status: outcomes.some((o) => o.status === "failed") ? "failed" : "partial", message: reason };
}
