// Scoring rubric (ADR 0006). Shared by interviewer scorecards and the AI assessment
// (ADR 0009). Bump RUBRIC_VERSION when the meaning of a score changes; it's stored on
// every scorecard.

import { z } from "zod";
import { PHASES, type Phase } from "@/lib/interview/phases";

/** v2: added communication as an aspect; scorecards are interviewer-only. */
export const RUBRIC_VERSION = 2;

/**
 * What a scorecard grades: each phase of the interview, plus communication across the
 * whole session. The SQL function public.evaluation_aspects() repeats this list.
 */
export const ASPECTS = [
  ...PHASES.map((p) => ({ value: p.value, label: p.label })),
  { value: "communication", label: "Communication" },
] as const;

export type Aspect = Phase | "communication";
export const ASPECT_VALUES = ASPECTS.map((a) => a.value) as [Aspect, ...Aspect[]];
export const aspectLabel = (aspect: string) => ASPECTS.find((a) => a.value === aspect)?.label ?? aspect;

export const SCORES = [
  { value: 1, label: "No signal", hint: "Didn't get there, or the approach wouldn't work." },
  { value: 2, label: "Mixed", hint: "Partly there; needed heavy prompting or missed key points." },
  { value: 3, label: "Solid", hint: "Meets the bar for the target level with light prompting." },
  { value: 4, label: "Strong", hint: "Above the bar: drove it, anticipated follow-ups, quantified." },
] as const;

// keep in sync with the CHECK on session_evaluations.recommendation
export const RECOMMENDATIONS = [
  { value: "strong_no", label: "Strong no" },
  { value: "no", label: "No" },
  { value: "yes", label: "Yes" },
  { value: "strong_yes", label: "Strong yes" },
] as const;

export type Recommendation = (typeof RECOMMENDATIONS)[number]["value"];

/** What each aspect assesses, and what a 3 ("solid") looks like. */
export const RUBRIC: Record<Aspect, { assesses: string; solid: string[] }> = {
  requirements: {
    assesses: "Scoping and clarifying before designing",
    solid: [
      "Asks about users, core use cases and what's out of scope",
      "Gets non-functional targets: scale, latency, availability, consistency",
      "Writes the agreed requirements down and refers back to them",
    ],
  },
  estimation: {
    assesses: "Back-of-the-envelope reasoning",
    solid: [
      "Derives read/write QPS (average and peak) and storage growth",
      "Uses the numbers to make decisions, not as a ritual",
      "Spots the dominant cost or hot spot",
    ],
  },
  api_data_model: {
    assesses: "Interfaces, entities and access patterns",
    solid: [
      "Defines the key endpoints or events with their inputs and outputs",
      "Chooses entities, keys and indexes from the access patterns",
      "Considers idempotency, pagination and versioning where they matter",
    ],
  },
  high_level_design: {
    assesses: "An end-to-end design that meets the requirements",
    solid: [
      "Components and data flow cover every core use case",
      "Storage and communication choices are justified",
      "The design is explained clearly while it's drawn",
    ],
  },
  deep_dive: {
    assesses: "Depth on the hardest part of the problem",
    solid: [
      "Identifies the real bottleneck or the riskiest component",
      "Handles scaling, consistency and failure modes concretely",
      "Responds to probes with specifics rather than buzzwords",
    ],
  },
  tradeoffs: {
    assesses: "Judgement and self-awareness",
    solid: [
      "Names what was traded away and why",
      "Knows what breaks first and how they'd detect it",
      "Proposes sensible next steps",
    ],
  },
  communication: {
    assesses: "Clarity and collaboration throughout",
    solid: [
      "Thinks out loud and keeps the interviewer oriented",
      "Takes hints and pushback well; changes course when wrong",
      "Structures the discussion and manages the time",
    ],
  },
};

const aspectScore = z.object({
  score: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).nullable(),
  evidence: z.string().trim().max(2000, "Keep evidence under 2,000 characters."),
});

export type AspectScore = z.infer<typeof aspectScore>;
/** Keyed by the aspect keys of the session's rubric (built-in or custom). */
export type Scores = Partial<Record<string, AspectScore>>;

export const ASPECT_KEY = /^[a-z][a-z0-9_]{0,39}$/;

const recommendationSchema = z.enum(RECOMMENDATIONS.map((r) => r.value) as [Recommendation, ...Recommendation[]]);

export const evaluationSchema = z
  .object({
    // The database checks the keys against the session's rubric (scores_valid).
    scores: z.record(z.string().regex(ASPECT_KEY, "Unknown aspect."), aspectScore),
    recommendation: recommendationSchema.nullable(),
    summary: z.string().trim().max(5000, "Keep the summary under 5,000 characters."),
    submit: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (!v.submit) return;
    if (!Object.values(v.scores).some((s) => s?.score != null)) {
      ctx.addIssue({ code: "custom", path: ["scores"], message: "Score at least one aspect before submitting." });
    }
    if (!v.recommendation) {
      ctx.addIssue({ code: "custom", path: ["recommendation"], message: "Choose a recommendation." });
    }
    if (!v.summary) ctx.addIssue({ code: "custom", path: ["summary"], message: "Write a short summary." });
  });

export type EvaluationInput = z.infer<typeof evaluationSchema>;

/** Average of the scored aspects, or null when nothing is scored. */
export function averageScore(scores: Scores) {
  const values = Object.values(scores)
    .map((s) => s?.score)
    .filter((s): s is 1 | 2 | 3 | 4 => s != null);
  if (!values.length) return null;
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
}

export const scoreLabel = (score: number | null | undefined) =>
  SCORES.find((s) => s.value === score)?.label ?? "Not scored";

export const recommendationLabel = (value: string | null | undefined) =>
  RECOMMENDATIONS.find((r) => r.value === value)?.label ?? "";

/** A custom rubric, as admins write it (ADR 0011). Mirrors public.rubric_valid(). */
export const rubricSchema = z
  .object({
    name: z.string().trim().min(1, "Name the rubric.").max(80, "Keep the name under 80 characters."),
    aspects: z
      .array(
        z.object({
          key: z.string().regex(ASPECT_KEY, "Keys are lowercase letters, digits and underscores."),
          label: z.string().trim().min(1, "Every aspect needs a name.").max(60, "Keep aspect names under 60 characters."),
          assesses: z.string().trim().max(300, "Keep the description under 300 characters."),
          solid: z.array(z.string().trim().min(1).max(300)).max(8, "Up to 8 signals per aspect."),
        }),
      )
      .min(1, "Add at least one aspect.")
      .max(12, "Up to 12 aspects."),
  })
  .superRefine((r, ctx) => {
    const keys = r.aspects.map((a) => a.key);
    if (new Set(keys).size !== keys.length) {
      ctx.addIssue({ code: "custom", path: ["aspects"], message: "Two aspects have the same name." });
    }
  });

export type RubricInput = z.infer<typeof rubricSchema>;

/** "Code quality & tests" → "code_quality_tests": a stable key from an aspect's name. */
export function aspectKey(label: string) {
  const k = label
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // accents: é → e
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return /^[a-z]/.test(k) ? k : `a_${k}`.slice(0, 40);
}
