// Round types (ADR 0010): what a round's phases are, how long they take, what the room
// looks like and how it's graded by default. SQL repeats the round types, phases, default
// aspect keys and languages (round_types(), round_phases(), default_aspects(),
// code_languages()); src/lib/__tests__/interview-sync.test.ts fails if they drift.

import { PHASES } from "@/lib/interview/phases";
import { GENERIC_PROBES } from "@/lib/interview/probes";
import { ASPECTS, RUBRIC } from "@/lib/interview/rubric";

export type RoundType = "system_design" | "coding" | "behavioural";
export type PhaseDef = { value: string; label: string; goal: string };
export type RubricAspect = { key: string; label: string; assesses: string; solid: string[] };
export type Rubric = { name: string; aspects: RubricAspect[] };
type Plan = Record<string, number>;

type RoundDef = {
  value: RoundType;
  label: string;
  description: string;
  /** The room's main panel. */
  workspace: "board" | "code" | "conversation";
  phases: PhaseDef[];
  plans: { standard: Plan; senior: Plan; staff: Plan };
  rubric: Rubric;
  /** General follow-ups per phase, shown next to the problem's own. */
  probes: Record<string, string[]>;
};

const SYSTEM_DESIGN: RoundDef = {
  value: "system_design",
  label: "System design",
  description: "A shared whiteboard: requirements through trade-offs on a large-scale design problem.",
  workspace: "board",
  phases: PHASES.map((p) => ({ value: p.value, label: p.label, goal: p.goal })),
  plans: {
    standard: { requirements: 5, estimation: 5, api_data_model: 7, high_level_design: 13, deep_dive: 11, tradeoffs: 4 },
    senior: { requirements: 5, estimation: 5, api_data_model: 7, high_level_design: 13, deep_dive: 14, tradeoffs: 6 },
    staff: { requirements: 7, estimation: 5, api_data_model: 8, high_level_design: 15, deep_dive: 18, tradeoffs: 7 },
  },
  rubric: {
    name: "System design (built-in)",
    aspects: ASPECTS.map((a) => ({ key: a.value, label: a.label, assesses: RUBRIC[a.value].assesses, solid: [...RUBRIC[a.value].solid] })),
  },
  probes: GENERIC_PROBES,
};

const CODING: RoundDef = {
  value: "coding",
  label: "Coding",
  description: "A shared code editor: the candidate writes and talks through a solution; interviewers watch live.",
  workspace: "code",
  phases: [
    { value: "understand", label: "Understand", goal: "Restate the problem, ask about inputs, outputs, constraints and edge cases." },
    { value: "approach", label: "Approach", goal: "Talk through one or two approaches and their complexity before writing code." },
    { value: "implement", label: "Implement", goal: "Write clean, working code for the chosen approach, explaining as they go." },
    { value: "test", label: "Test", goal: "Walk through examples and edge cases, find and fix bugs." },
    { value: "complexity", label: "Complexity & wrap-up", goal: "State time and space complexity and what they'd improve." },
  ],
  plans: {
    standard: { understand: 5, approach: 8, implement: 20, test: 7, complexity: 5 },
    senior: { understand: 5, approach: 8, implement: 20, test: 7, complexity: 5 },
    staff: { understand: 5, approach: 10, implement: 20, test: 8, complexity: 7 },
  },
  rubric: {
    name: "Coding (built-in)",
    aspects: [
      {
        key: "problem_solving",
        label: "Problem solving",
        assesses: "Breaking the problem down and choosing an approach",
        solid: ["Clarifies constraints and edge cases first", "Considers more than one approach", "Picks one for a stated reason"],
      },
      {
        key: "code_quality",
        label: "Code quality",
        assesses: "Readable, well-structured code",
        solid: ["Clear names and small functions", "Idiomatic for the language", "No dead code or copy-paste"],
      },
      {
        key: "correctness",
        label: "Correctness & testing",
        assesses: "Working code and the habit of checking it",
        solid: ["Code works for the main cases", "Tests edge cases unprompted", "Finds and fixes their own bugs"],
      },
      {
        key: "complexity",
        label: "Complexity",
        assesses: "Reasoning about time and space",
        solid: ["States time and space complexity correctly", "Knows where the bottleneck is", "Can improve it when asked"],
      },
      {
        key: "communication",
        label: "Communication",
        assesses: "Thinking out loud and collaborating",
        solid: ["Explains while coding", "Takes hints well", "Keeps the interviewer oriented"],
      },
    ],
  },
  probes: {
    understand: ["What should happen with empty or very large input?", "Can the input contain duplicates or negatives?", "What do you return if there's no answer?"],
    approach: ["What's the brute-force approach and its cost?", "Can you do better than that?", "Which data structure fits the access pattern?"],
    implement: ["Why that data structure here?", "How would you name this helper?", "What happens on this line if the input is empty?"],
    test: ["Walk me through your code with this example.", "Which edge case worries you most?", "How would you unit-test this?"],
    complexity: ["What's the time and space complexity?", "What if the input were 100× bigger?", "What would you change in production code?"],
  },
};

const BEHAVIOURAL: RoundDef = {
  value: "behavioural",
  label: "Behavioural",
  description: "A structured conversation about past experience; the interviewer asks questions and takes notes.",
  workspace: "conversation",
  phases: [
    { value: "intro", label: "Introductions", goal: "Set the tone, explain the format, and hear a short summary of their background." },
    { value: "experience", label: "Past experience", goal: "Dig into specific situations they've handled: what happened, what they did, the result." },
    { value: "scenarios", label: "Scenarios", goal: "Hypothetical situations to probe judgement where their experience doesn't reach." },
    { value: "candidate_questions", label: "Their questions", goal: "Leave time for the candidate's questions about the team and role." },
  ],
  plans: {
    standard: { intro: 5, experience: 20, scenarios: 10, candidate_questions: 10 },
    senior: { intro: 5, experience: 22, scenarios: 10, candidate_questions: 8 },
    staff: { intro: 5, experience: 25, scenarios: 12, candidate_questions: 8 },
  },
  rubric: {
    name: "Behavioural (built-in)",
    aspects: [
      {
        key: "ownership",
        label: "Ownership",
        assesses: "Taking responsibility beyond the task",
        solid: ["Describes what *they* did, not the team", "Followed through when it got hard", "Owns mistakes without blame"],
      },
      {
        key: "collaboration",
        label: "Collaboration",
        assesses: "Working with and through others",
        solid: ["Brings others along", "Handles disagreement constructively", "Credits colleagues"],
      },
      {
        key: "judgement",
        label: "Judgement",
        assesses: "Decisions under ambiguity and trade-offs",
        solid: ["Explains why they chose what they did", "Weighs risk sensibly", "Knows when to escalate"],
      },
      {
        key: "impact",
        label: "Impact",
        assesses: "Results that mattered, at the right scope for the level",
        solid: ["Concrete outcomes, ideally measured", "Scope fits the level", "Prioritised what mattered"],
      },
      {
        key: "self_awareness",
        label: "Self-awareness",
        assesses: "Learning from experience",
        solid: ["Says what they'd do differently", "Seeks and uses feedback", "Knows their growth areas"],
      },
      {
        key: "communication",
        label: "Communication",
        assesses: "Clear, structured answers",
        solid: ["Answers the question asked", "Uses situation, action, result", "Concise; adapts depth when asked"],
      },
    ],
  },
  probes: {
    intro: ["Walk me through your background in two minutes.", "What are you looking for in your next role?"],
    experience: [
      "Tell me about a project you're proud of. What was your part?",
      "Tell me about a time you disagreed with a teammate or manager. What happened?",
      "Tell me about a time something you owned failed. What did you do?",
      "What exactly did you do, as opposed to the team?",
      "What was the result, and how did you know?",
    ],
    scenarios: [
      "Your project is two weeks late and the deadline is fixed. What do you do?",
      "A senior colleague keeps rejecting your design without explanation. How do you handle it?",
      "You find a serious bug in another team's service the night before a launch. What now?",
    ],
    candidate_questions: ["What questions do you have for us?"],
  },
};

export const ROUNDS: Record<RoundType, RoundDef> = {
  system_design: SYSTEM_DESIGN,
  coding: CODING,
  behavioural: BEHAVIOURAL,
};

export const ROUND_TYPES = [SYSTEM_DESIGN, CODING, BEHAVIOURAL].map((r) => ({ value: r.value, label: r.label, description: r.description }));
export const ROUND_VALUES = ROUND_TYPES.map((r) => r.value) as [RoundType, ...RoundType[]];

export const isRoundType = (v: unknown): v is RoundType => typeof v === "string" && v in ROUNDS;
export const roundOf = (v: string | null | undefined) => ROUNDS[isRoundType(v) ? v : "system_design"];
export const roundLabel = (v: string | null | undefined) => roundOf(v).label;

export function roundPlanFor(round: RoundType, seniority: string | null | undefined): Plan {
  const { plans } = ROUNDS[round];
  if (seniority === "staff" || seniority === "principal") return { ...plans.staff };
  if (seniority === "senior") return { ...plans.senior };
  return { ...plans.standard };
}

/** The rubric a session is graded on: its snapshot, or the built-in one for older sessions. */
export const sessionRubric = (session: { rubric?: unknown; round_type?: string | null }): Rubric =>
  (session.rubric as Rubric | null) ?? roundOf(session.round_type).rubric;

/** Every phase across round types, for labels. Phase values are unique across rounds. */
const ALL_PHASES = Object.values(ROUNDS).flatMap((r) => r.phases);
export const anyPhaseLabel = (phase: string | null | undefined) => ALL_PHASES.find((p) => p.value === phase)?.label ?? phase ?? "";

export const CODE_LANGUAGES = [
  { value: "python", label: "Python" },
  { value: "javascript", label: "JavaScript" },
  { value: "typescript", label: "TypeScript" },
  { value: "java", label: "Java" },
  { value: "cpp", label: "C++" },
  { value: "go", label: "Go" },
] as const;

export type CodeLanguage = (typeof CODE_LANGUAGES)[number]["value"];
export const codeLanguageLabel = (v: string | null | undefined) => CODE_LANGUAGES.find((l) => l.value === v)?.label ?? v ?? "";
