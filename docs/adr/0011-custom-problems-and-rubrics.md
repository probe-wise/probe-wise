# 0011. Workspaces write their own problems and rubrics; sessions snapshot the rubric

- Status: Accepted
- Date: 2026-11-01
- Amends: ADR 0004 (problem bank in code)

## Context

Companies interview for their own domain and calibrate on their own values. The built-in bank and rubric are a
starting point, not the end.

## Decision

- **Problems** (`problems`): any member writes them for a round type: candidate prompt, focus, levels, starter code
  (coding) and the confidential guide (follow-ups, clarifications, numbers, signals, pitfalls, reference). Editing
  content bumps `version`; the round type is fixed. Problems are archived, never deleted, because interviews point
  at them. Only the workspace can read them; candidates get the prompt through the session snapshot.
- **Rubrics** (`rubrics`): admins write them per round type (up to 12 aspects, each with what it assesses and what
  a 3 looks like) and can make one the default. `public.rubric_valid()` checks the shape.
- **Every session stores a copy of its rubric** (`interview_sessions.rubric`). Scorecards and the AI assessment are
  validated against that copy (`session_aspects()` → `scores_valid()`), so editing or archiving a rubric never
  changes or invalidates past scorecards. Sessions from before this change have no copy and use the built-in rubric.
- Aspect keys are derived from names once and kept on edit, so renaming an aspect doesn't orphan scores.

## Consequences

- The scheduling form offers built-in and custom problems and rubrics per round; the defaults are preselected.
- Custom problems close ADR 0004's snapshot-forgery gap for themselves: `create_session` checks the problem is the
  workspace's, matches the round and isn't archived.

## Alternatives considered

- **Reference the rubric by id**: an edit would silently re-grade old interviews.
- **Free-form scorecards**: no comparison across interviewers or with the AI.
