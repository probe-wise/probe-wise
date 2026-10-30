import type { Phase } from "@/lib/interview/phases";

/**
 * General follow-ups for each phase, shown to interviewers next to the
 * problem-specific ones. Fine to show to the candidate's side too: they're standard.
 */
export const GENERIC_PROBES: Record<Phase, string[]> = {
  requirements: [
    "Who are the users, and what are the two or three things they must be able to do?",
    "What's explicitly out of scope?",
    "Which matters more here: consistency or availability?",
  ],
  estimation: [
    "What's the peak QPS, not just the average?",
    "How much storage after one year? After five?",
    "Which number most changes your design?",
  ],
  api_data_model: [
    "What happens if the client retries this request?",
    "What's the primary key, and what's your most frequent query?",
    "How would you paginate this?",
  ],
  high_level_design: [
    "Walk me through one request end to end.",
    "Why this database over the alternatives?",
    "Where is the single point of failure?",
  ],
  deep_dive: [
    "Traffic grows 10×. What breaks first?",
    "This node dies mid-request. What does the user see?",
    "How would you know this is broken in production?",
  ],
  tradeoffs: [
    "What did you trade away with this design?",
    "If you had another week, what would you change?",
    "What would you build differently for one-tenth of the scale?",
  ],
};
