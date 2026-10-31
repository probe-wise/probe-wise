# 0006. Scorecards: immutable once submitted, released without anchoring

- Status: Accepted, amended 2026-10-31 by [0007](0007-company-workspaces.md) and [0009](0009-ai-assessment.md):
  scorecards are interviewer-only (no self-assessment), the candidate never sees them, the workspace reads submitted
  ones, and the AI assessment follows the same release rule
- Date: 2026-10-30

## Context

Evaluation is the point of the product. Interview-calibration practice is to write feedback independently, before
seeing anyone else's, and never to change it afterwards.

## Decision

- One evaluation per participant per session: interviewers write a **scorecard**, the candidate writes a
  **self-assessment**. Both score each phase from 1 to 4 (1 no signal, 2 mixed, 3 solid for the level, 4 strong) and
  attach written evidence. Interviewers add an overall recommendation on a 4-point scale (no "maybe").
- Drafts can be saved during and after the session. **Submission is allowed only after the session ends**, and a
  submitted evaluation can't be changed (enforced by the function and a trigger).
- Visibility: an author always sees their own. The candidate sees interviewer scorecards once they're submitted.
  An interviewer sees other evaluations, including the self-assessment, only after submitting their own.
- Submission records an `evaluation.submitted` event that contains a hash of the scorecard.

## Consequences

- Fair, bias-resistant feedback that also gives milestone 3's automated scorer a clean training and evaluation signal.
- A mistake can't be edited out once submitted. This is intentional; a follow-up "addendum" note can be added later.
