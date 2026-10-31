# 0005. Session participants, roles and invites

- Status: Superseded in part by [0007](0007-company-workspaces.md) and [0008](0008-candidate-access-by-link.md)
  (participant rows and consent still apply; modes and interviewer invites are gone)
- Date: 2026-10-30

## Context

A session must be visible to the interviewee and the interviewer. Milestone 3 adds an AI interviewer. Invited
interviewers may not be members.

## Decision

- `session_participants` has a row per person: `role` (`candidate` or `interviewer`), `display_name`, `consented_at`.
  Events reference the **participant**, not the auth user, so the log stays verifiable when an account is deleted.
  In that case `user_id` is set to null and the name is replaced with "Deleted user".
- Modes: `solo` (candidate controls the timer) and `peer` (interviewers control phases and the end; the candidate can
  cancel before the session starts). Milestone 3 adds the AI as an interviewer participant.
- Invites: the server generates a 256-bit random token, and the database stores only its SHA-256. Invites are
  single-use, expire after 7 days, and are revoked when a new one is made. At most 2 interviewers per session.
  Interviewers must be signed in but need no seat.
- **Recording consent is required to join**. It's stored on the participant row and as a `consent.given` event.

## Consequences

- Clear permission matrix (see the architecture doc), enforced in SQL.
- Interviewers without a seat can use only invite-based pages, not the dashboard.

## Alternatives considered

- **Open links (anyone with the URL can view)**: no accountability for an audited record.
- **Email-addressed invites**: needs transactional email (milestone 4). A link can be shared over any channel today.
