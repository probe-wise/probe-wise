// Scoring rubric (ADR 0006). Shared by interviewer scorecards and self-assessments,
// and by the automated scorer in milestone 3. Bump RUBRIC_VERSION when the meaning
// of a score changes; it's stored on every evaluation.

import { z } from "zod";
import { PHASE_VALUES, type Phase } from "@/lib/interview/phases";

export const RUBRIC_VERSION = 1;

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

/** What each phase assesses, and what a 3 ("solid") looks like. */
export const RUBRIC: Record<Phase, { assesses: string; solid: string[] }> = {
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
};

const phaseScore = z.object({
  score: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).nullable(),
  evidence: z.string().trim().max(2000, "Keep evidence under 2,000 characters."),
});

export type PhaseScore = z.infer<typeof phaseScore>;
export type Scores = Partial<Record<Phase, PhaseScore>>;

export const evaluationSchema = z
  .object({
    kind: z.enum(["scorecard", "self"]),
    scores: z.partialRecord(z.enum(PHASE_VALUES), phaseScore),
    recommendation: z.enum(RECOMMENDATIONS.map((r) => r.value) as [Recommendation, ...Recommendation[]]).nullable(),
    summary: z.string().trim().max(5000, "Keep the summary under 5,000 characters."),
    submit: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (v.kind === "self" && v.recommendation) {
      ctx.addIssue({ code: "custom", path: ["recommendation"], message: "A self-assessment has no recommendation." });
    }
    if (!v.submit) return;
    if (!Object.values(v.scores).some((s) => s?.score != null)) {
      ctx.addIssue({ code: "custom", path: ["scores"], message: "Score at least one phase before submitting." });
    }
    if (v.kind === "scorecard") {
      if (!v.recommendation) {
        ctx.addIssue({ code: "custom", path: ["recommendation"], message: "Choose a recommendation." });
      }
      if (!v.summary) ctx.addIssue({ code: "custom", path: ["summary"], message: "Write a short summary." });
    }
  });

export type EvaluationInput = z.infer<typeof evaluationSchema>;

/** Average of the scored phases, or null when nothing is scored. */
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
