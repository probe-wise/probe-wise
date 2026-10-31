import type { CodeLanguage, RoundType } from "@/lib/interview/rounds";
import type { Domain, Seniority, TargetRole } from "@/lib/profile-options";

export type ProblemDomain = Domain | "general";

/** What the candidate sees. Snapshotted onto the session when it's created (ADR 0004). */
export type ProblemPrompt = {
  summary: string;
  prompt: string;
};

/** Confidential: rendered only for interviewers, never sent to the candidate's browser. */
export type InterviewerGuide = {
  /** Answers to give when the candidate asks. Rewards candidates who clarify. */
  clarifications: { q: string; a: string }[];
  /** Numbers to hand out during estimation. */
  scale: string[];
  /** Problem-specific follow-ups, roughly in the order they become relevant. */
  probes: string[];
  /** What separates a strong answer. */
  strongSignals: string[];
  pitfalls: string[];
  /** Outline of a good design, for the interviewer's reference and the review page. */
  reference: string[];
};

export type Problem = ProblemPrompt & {
  /** Defaults to system design (the original bank). */
  roundType?: RoundType;
  /** Coding rounds: the editor's starting language and contents. */
  language?: CodeLanguage;
  starterCode?: string;
  /** Set for a workspace's own problems (ADR 0011); built-in ones have none. */
  id?: string;
  slug: string;
  /** Bump when the prompt or guide changes meaningfully; stored on each session. */
  version: number;
  title: string;
  domain: ProblemDomain;
  /** Levels the problem is calibrated for. */
  levels: readonly Seniority[];
  /** Roles it fits especially well (empty = any engineering role). Used for ranking only. */
  roles: readonly TargetRole[];
  /** One line on what follow-ups to expect. Shown to candidates. */
  focus: string;
  guide: InterviewerGuide;
};

/** Safe to send to any client. */
export type ProblemSummary = Omit<Problem, "guide" | "prompt" | "starterCode"> & { roundType: RoundType; custom: boolean };
