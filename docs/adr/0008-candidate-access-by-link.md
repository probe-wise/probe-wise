# 0008. Candidates join by a one-time link, without an account

- Status: Accepted
- Date: 2026-10-31

## Context

Candidates need to get into the room quickly, often minutes before the interview, and shouldn't have to create an
account with a company's tool. But every action in the room is recorded against a participant, and realtime and
RLS need an authenticated identity.

## Decision

- An interviewer (or any member) creates a **candidate link** from the lobby or during the interview
  (`create_candidate_link`). 256-bit token, SHA-256 stored, single use, 24 hours by default (1–168), revoked when a
  new one is made and when the interview ends.
- `/join/<token>` is public. It previews the company and the candidate's name (`candidate_link_preview`, callable by
  `anon`), asks for a display name and recording consent, then signs the browser in with a **Supabase anonymous
  session** and calls `accept_candidate_link`.
- The anonymous session only opens the interview room: the proxy sends it to `/login` for any other protected page,
  the DAL never treats it as a member, and it can't create a workspace.
- **Switching device**: a new link moves the candidate's participant row to the new browser (`rejoined: true` in the
  `participant.joined` event). The old browser loses access.
- Members of the company can't accept their own candidate link (they'd become the candidate in their own record).
- Candidates see the problem, the board, the chat and the company's name. They never see candidate records,
  scorecards, the AI assessment, private notes or the interviewer guide, and the room ends with a thank-you rather
  than a review.

## Consequences

- Requires **Anonymous sign-ins** to be enabled in Supabase (Authentication → Sign In / Providers). Supabase
  recommends CAPTCHA or rate limits for anonymous sign-ups in production.
- Anonymous users accumulate; Supabase can purge old ones. Their participant rows are kept (`user_id` set to null).

## Alternatives considered

- **Magic link to the candidate's email**: proves identity, but adds an inbox round trip at the worst moment and
  needs the email to be right.
- **A bearer token in the room URL, no auth user**: would need a parallel authorisation path for every RPC and
  for Realtime. Anonymous sessions reuse the existing one.
