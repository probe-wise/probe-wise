"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getMembership, getViewer } from "@/lib/dal";
import { sessionErrorMessage } from "@/lib/interview/errors";
import { aspectKey, rubricSchema } from "@/lib/interview/rubric";
import { CODE_LANGUAGES, ROUND_VALUES, type CodeLanguage, type RoundType } from "@/lib/interview/rounds";
import { SENIORITY_LEVELS, values } from "@/lib/profile-options";
import { createClient } from "@/lib/supabase/server";
import { cleanMultiline, cleanText } from "@/lib/text";

// A workspace's own problems and rubrics (ADR 0011). Plain table writes under RLS:
// any member writes problems; only admins write rubrics.

export type LibraryState = {
  status: "idle" | "error" | "saved";
  message?: string;
  fieldErrors?: Record<string, string>;
  savedAt?: number;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function requireWorkspace(next: string) {
  const viewer = await getViewer();
  if (!viewer || viewer.anonymous) redirect(`/login?next=${encodeURIComponent(next)}`);
  const membership = await getMembership();
  if (!membership) redirect("/onboarding");
  return membership;
}

/** One item per line; blank lines dropped. */
const lines = (raw: unknown, max = 30) =>
  cleanMultiline(raw)
    .split("\n")
    .map((l) => l.replace(/^\s*[-*•]\s*/, "").trim())
    .filter(Boolean)
    .slice(0, max);

/** "Question :: answer" per line. */
const pairs = (raw: unknown) =>
  lines(raw)
    .map((l) => l.split(/\s*::\s*/))
    .filter((p) => p.length >= 2 && p[0] && p[1])
    .map(([q, ...a]) => ({ q: q.slice(0, 300), a: a.join(" :: ").slice(0, 600) }));

const problemSchema = z
  .object({
    round_type: z.enum(ROUND_VALUES),
    title: z.string().min(1, "Give the problem a title.").max(200, "Keep the title under 200 characters."),
    summary: z.string().max(500, "Keep the summary under 500 characters."),
    prompt: z.string().min(1, "Write what the candidate sees.").max(8000, "Keep the prompt under 8,000 characters."),
    focus: z.string().max(200, "Keep this under 200 characters."),
    levels: z.array(z.enum(values(SENIORITY_LEVELS))),
    language: z.enum(CODE_LANGUAGES.map((l) => l.value) as [CodeLanguage, ...CodeLanguage[]]).nullable(),
    starter_code: z.string().max(20000, "Keep starter code under 20,000 characters."),
  })
  .superRefine((v, ctx) => {
    if (v.round_type === "coding" && !v.language) ctx.addIssue({ code: "custom", path: ["language"], message: "Pick a language." });
  });

/** Create a problem, or edit one when the form carries an id. Edits bump its version. */
export async function saveProblem(_prev: LibraryState, formData: FormData): Promise<LibraryState> {
  const id = String(formData.get("id") ?? "");
  const { org } = await requireWorkspace(id ? `/problems/custom/${id}` : "/problems/new");
  const round = String(formData.get("round_type") ?? "") as RoundType;
  const parsed = problemSchema.safeParse({
    round_type: round,
    title: cleanText(formData.get("title")),
    summary: cleanText(formData.get("summary")),
    prompt: cleanMultiline(formData.get("prompt")),
    focus: cleanText(formData.get("focus")),
    levels: formData.getAll("levels").map(String),
    language: round === "coding" ? String(formData.get("language") ?? "") || null : null,
    // Code keeps its indentation: only normalise line endings.
    starter_code: round === "coding" ? String(formData.get("starter_code") ?? "").replace(/\r\n?/g, "\n") : "",
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] ??= issue.message;
    return { status: "error", message: "Fix the highlighted fields.", fieldErrors };
  }
  const guide = {
    clarifications: pairs(formData.get("clarifications")),
    scale: lines(formData.get("scale")),
    probes: lines(formData.get("probes")),
    strongSignals: lines(formData.get("strong_signals")),
    pitfalls: lines(formData.get("pitfalls")),
    reference: lines(formData.get("reference")),
  };
  if (!guide.probes.length) return { status: "error", message: "Add at least one follow-up question.", fieldErrors: { probes: "Add at least one." } };

  const { round_type, ...content } = parsed.data;
  const supabase = await createClient();
  if (id) {
    if (!UUID.test(id)) return { status: "error", message: "Unknown problem." };
    const { data, error } = await supabase.from("problems").update({ ...content, guide }).eq("id", id).select("id");
    if (error || !data?.length) return { status: "error", message: "We couldn't save the problem. Please try again." };
    refresh();
    return { status: "saved", savedAt: Date.now() };
  }
  const { data, error } = await supabase
    .from("problems")
    .insert({ ...content, guide, round_type, org_id: org.id })
    .select("id")
    .single();
  if (error || !data) {
    console.error("problem insert failed", error);
    return { status: "error", message: "We couldn't save the problem. Please try again." };
  }
  redirect(`/problems/custom/${data.id}?created=1`);
}

/** Archived problems can't be scheduled; past interviews keep working. */
export async function setProblemArchived(id: string, archived: boolean): Promise<LibraryState> {
  await requireWorkspace(`/problems/custom/${id}`);
  if (!UUID.test(id)) return { status: "error", message: "Unknown problem." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("problems")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", id)
    .select("id");
  if (error || !data?.length) return { status: "error", message: "We couldn't update the problem." };
  refresh();
  return { status: "saved", savedAt: Date.now() };
}

export type RubricDraft = {
  name: string;
  aspects: { key?: string; label: string; assesses: string; solid: string }[];
};

/** Create or edit a rubric (admins). Keys come from aspect names and stay stable on edit. */
export async function saveRubric(id: string | null, round: string, draft: RubricDraft): Promise<LibraryState> {
  const { org, member } = await requireWorkspace("/rubrics");
  if (member.role !== "admin") return { status: "error", message: "Only admins manage rubrics." };
  const roundType = z.enum(ROUND_VALUES).safeParse(round);
  if (!roundType.success) return { status: "error", message: "Unknown round type." };

  const parsed = rubricSchema.safeParse({
    name: cleanText(draft.name),
    aspects: draft.aspects.map((a) => ({
      key: a.key && /^[a-z][a-z0-9_]{0,39}$/.test(a.key) ? a.key : aspectKey(cleanText(a.label)),
      label: cleanText(a.label),
      assesses: cleanText(a.assesses),
      solid: lines(a.solid, 8),
    })),
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the rubric." };

  const supabase = await createClient();
  if (id) {
    if (!UUID.test(id)) return { status: "error", message: "Unknown rubric." };
    const { data, error } = await supabase
      .from("rubrics")
      .update({ name: parsed.data.name, aspects: parsed.data.aspects })
      .eq("id", id)
      .select("id");
    if (error || !data?.length) return { status: "error", message: "We couldn't save the rubric." };
    refresh();
    return { status: "saved", savedAt: Date.now() };
  }
  const { data, error } = await supabase
    .from("rubrics")
    .insert({ org_id: org.id, round_type: roundType.data, name: parsed.data.name, aspects: parsed.data.aspects })
    .select("id")
    .single();
  if (error || !data) {
    console.error("rubric insert failed", error);
    return { status: "error", message: "We couldn't save the rubric." };
  }
  redirect(`/rubrics/${data.id}?created=1`);
}

export async function setDefaultRubric(round: string, rubricId: string | null): Promise<LibraryState> {
  await requireWorkspace("/rubrics");
  const roundType = z.enum(ROUND_VALUES).safeParse(round);
  if (!roundType.success) return { status: "error", message: "Unknown round type." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_default_rubric", { p_round_type: roundType.data, p_rubric: rubricId });
  if (error) return { status: "error", message: sessionErrorMessage(error) };
  refresh();
  return { status: "saved", savedAt: Date.now() };
}

export async function archiveRubric(id: string): Promise<LibraryState> {
  await requireWorkspace("/rubrics");
  if (!UUID.test(id)) return { status: "error", message: "Unknown rubric." };
  const supabase = await createClient();
  const { data: row } = await supabase.from("rubrics").select("is_default").eq("id", id).maybeSingle();
  if (row?.is_default) return { status: "error", message: "Pick another default before archiving this rubric." };
  const { data, error } = await supabase.from("rubrics").update({ archived_at: new Date().toISOString() }).eq("id", id).select("id");
  if (error || !data?.length) return { status: "error", message: "Only admins can archive rubrics." };
  redirect("/rubrics?archived=1");
}
