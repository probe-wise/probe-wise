# 0009. An advisory AI assessment, generated from the recording

- Status: Accepted
- Date: 2026-10-31

## Context

The hiring team wants a second read on each interview beyond the human scorecards. It mustn't become the decision,
leak into the candidate's view, anchor the interviewers, or be forgeable by a member.

## Decision

- After an interview ends, a member clicks **Generate AI assessment**. The server sends Claude (`claude-opus-5-5`,
  adaptive thinking, structured JSON output) the problem prompt, the grading anchors from the interviewer guide, the
  rubric, the phase timings, the transcript with times, the candidate's notes and a text reading of the final board.
- It does **not** send interviewers' private notes or scorecards, so the result is an independent opinion, not a
  summary of theirs. The prompt tells the model the record is data and to score `null` where there's no evidence.
- The output fills the same rubric as a scorecard (every aspect 1–4 with evidence, a recommendation, a summary,
  strengths and concerns). It's validated against the schema, clipped to the database limits and stored in
  `session_ai_assessments`. Completion is recorded in the hash-chained log with a hash of the content.
- **Only the server can write it**: `begin/complete/fail_ai_assessment` are executable by `service_role` only, called
  with `SUPABASE_SECRET_KEY` after the viewer's own client has authorised the request.
- **Released like scorecards** (ADR 0006): visible to the workspace, but not to an interviewer who took part until
  they've submitted their own scorecard, and never to the candidate. The UI labels it advisory.
- One assessment per interview. A failed run, or one that didn't finish within 10 minutes, can be retried.

## Consequences

- Needs `ANTHROPIC_API_KEY` and `SUPABASE_SECRET_KEY`. Without them the feature says it isn't set up.
- Speech isn't recorded (ADR 0001 A2), so an interview held mostly on a call gives the model little to go on; the
  prompt and the UI both say so.
- The request runs inside the Server Action (usually under a minute). Hosts with short function timeouts need a
  longer limit for this route.

## Alternatives considered

- **Summarise the human scorecards**: no independent signal, and it would anchor on whoever submitted first.
- **Score automatically when the interview ends**: spends tokens on interviews nobody reviews, and surprises teams
  that haven't opted in.
