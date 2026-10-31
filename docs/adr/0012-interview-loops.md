# 0012. Loops: several rounds for one candidate, summarised together

- Status: Accepted
- Date: 2026-11-01

## Context

A hiring decision rests on several rounds (for example system design, coding and behavioural) with different
interviewers. Teams need one place that shows them side by side.

## Decision

- `interview_loops` belongs to a workspace and a candidate, with a name. Sessions point at it (`loop_id`). A loop is
  created when more than one round is scheduled at once, or when it's given a name.
- The loop page lists every round with its status, rubric, interviewers and, per aspect, each released scorecard
  and the AI's scores, plus a tally of recommendations across the loop.
- It reads through the same RLS as everything else, so ADR 0006's release rule holds: an interviewer sees a round's
  scores only after submitting their own for it, and the candidate never sees the loop.

## Consequences

- No final "hire" decision is recorded yet; the summary informs a debrief that happens elsewhere.
- Deleting a loop (admins) keeps its interviews.
