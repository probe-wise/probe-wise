# 0007. Companies run interviews: workspaces, members and candidate records

- Status: Accepted
- Date: 2026-10-31
- Supersedes: the milestone 1 seat cap and candidate profile (README decision log), and the candidate-led parts of ADR 0005

## Context

Milestones 1–2 built a practice tool: a candidate signed up for one of 100 seats, picked a problem and invited a
friend to interview them. The product is a hiring platform instead. A company adds the people it's interviewing,
its interviewers run the interview and grade it, and the candidate shouldn't steer any of that.

## Decision

- **Workspaces** (`organizations`). Whoever signs up first creates their company's workspace and becomes its admin.
  An account belongs to one workspace for now (`unique (user_id)`).
- **Members** (`org_members`) are `admin` or `interviewer`. Both can add candidates, schedule and run interviews and
  read submitted scorecards. Only admins invite, change roles, remove people, rename the workspace and delete
  candidates. A workspace always keeps at least one admin.
- **Team invites** (`org_invites`): a 256-bit link, stored as a SHA-256, single use, 7 days, **bound to an email
  address**. The person accepting must be signed in with that address. Without transactional email the link is
  copied and sent by the admin.
- **Candidates** (`candidates`) are records, not accounts: name, optional email (unique per workspace), role, level
  and private notes. Plain table writes, scoped by RLS to the caller's workspace.
- **Scheduling** (`create_session`) takes a candidate, a problem and 1–2 interviewers. Interviewers are created as
  *assigned* participants (`joined_at` null) and consent when they enter the room. Any member can step in while
  fewer than two interviewers have joined. The candidate's level sets the time per phase.
- **The whole hiring team** can read the workspace's interviews and the record (including interviewer-only
  events). Private notes stay with their author.
- The 100-seat cap, waitlist, onboarding profile and solo/peer modes are removed. Existing practice sessions are
  dropped by the migration: they belong to individuals and have no company to move to.

## Consequences

- One permission model: workspace membership for the team, participation for the room.
- Interviewers in a workspace no longer need invite links; only candidates do (ADR 0008).
- Multi-workspace accounts (agencies, contractors) need a workspace switcher later.

## Alternatives considered

- **Keep candidate accounts and attach them to companies**: the candidate would own data the company needs to
  manage (and delete on request). Records owned by the workspace are simpler and match how hiring tools work.
- **Invite links without an email binding**: anyone holding the link could join the company's workspace and read
  every candidate. Binding to an address costs one sign-in step.
