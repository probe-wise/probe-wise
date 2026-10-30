// Interview phases: single source of truth. The SQL function public.interview_phases()
// repeats the values; src/lib/__tests__/interview-sync.test.ts fails if they drift.

import type { Seniority } from "@/lib/profile-options";

export const PHASES = [
  {
    value: "requirements",
    label: "Requirements",
    goal: "Pin down what to build: core features, users, and the non-functional targets that drive the design.",
  },
  {
    value: "estimation",
    label: "Estimation",
    goal: "Turn the requirements into numbers: traffic, storage, bandwidth, and where the hot spots are.",
  },
  {
    value: "api_data_model",
    label: "API & data model",
    goal: "Define the interface and the entities, keys and access patterns the design has to serve.",
  },
  {
    value: "high_level_design",
    label: "High-level design",
    goal: "Sketch the main components and data flow that satisfy the requirements end to end.",
  },
  {
    value: "deep_dive",
    label: "Deep dive",
    goal: "Go deep on the hardest parts: scaling, consistency, failure handling, the bottleneck.",
  },
  {
    value: "tradeoffs",
    label: "Trade-offs & wrap-up",
    goal: "Name what you traded away, what breaks first, and what you'd do with more time.",
  },
] as const;

export type Phase = (typeof PHASES)[number]["value"];
export type PhasePlan = Record<Phase, number>;

export const PHASE_VALUES = PHASES.map((p) => p.value) as [Phase, ...Phase[]];

export const phaseLabel = (phase: string | null | undefined) =>
  PHASES.find((p) => p.value === phase)?.label ?? phase ?? "";

export const phaseIndex = (phase: string | null | undefined) => PHASES.findIndex((p) => p.value === phase);

export const nextPhase = (phase: string | null | undefined): Phase | null => {
  const i = phaseIndex(phase);
  return i >= 0 && i < PHASES.length - 1 ? PHASES[i + 1].value : null;
};

/**
 * Minutes per phase by level. Senior+ loops spend longer on the deep dive and
 * trade-offs, which is where those levels are actually assessed.
 */
const PLANS: Record<"standard" | "senior" | "staff", PhasePlan> = {
  standard: { requirements: 5, estimation: 5, api_data_model: 7, high_level_design: 13, deep_dive: 11, tradeoffs: 4 },
  senior: { requirements: 5, estimation: 5, api_data_model: 7, high_level_design: 13, deep_dive: 14, tradeoffs: 6 },
  staff: { requirements: 7, estimation: 5, api_data_model: 8, high_level_design: 15, deep_dive: 18, tradeoffs: 7 },
};

export function phasePlanFor(seniority: Seniority | string | null | undefined): PhasePlan {
  if (seniority === "staff" || seniority === "principal") return { ...PLANS.staff };
  if (seniority === "senior") return { ...PLANS.senior };
  return { ...PLANS.standard };
}

export const totalMinutes = (plan: PhasePlan) => PHASE_VALUES.reduce((sum, p) => sum + plan[p], 0);
