# 0002. Realtime via Supabase Broadcast sent from the database, on private channels

- Status: Accepted
- Date: 2026-10-30

## Context

The candidate and interviewer must see each other's changes live. Supabase gives us three options: Postgres
Changes, Broadcast and Presence. We also need authorisation, so non-participants can't listen in and private
interviewer events never reach the candidate.

## Decision

- **Durable events**: `_append_event` calls `realtime.send()` inside the same transaction as the insert. Events with
  visibility `all` go to the private topic `session:<id>`; `interviewers` events go to `session:<id>:interviewers`.
  If the transaction rolls back, nothing is broadcast, so anything a client sees live is already in the log.
- **Authorisation**: RLS policies on `realtime.messages` allow `select` (receive) on a session's topics only for its
  participants, and the `:interviewers` topic only for interviewers. Clients subscribe with `{ private: true }`.
- **Ephemeral traffic** (live board deltas while drawing, presence): clients broadcast directly on
  `session:<id>`. This needs an `insert` policy for participants. It's never stored, and the durable `board.updated`
  event follows within about 1.5 s.
- **Ordering and gaps**: clients track the last `seq` they've seen. A gap, or a reconnect, triggers a catch-up read
  from `session_events` (allowed by RLS).

## Consequences

- One mechanism covers both "it's saved" and "the other person sees it".
- Requires Realtime Authorization in the Supabase project, with "allow public access" turned off for private
  channels. This is documented in the README setup steps.
- Broadcast payloads are capped (about 256 KB on the free tier). Event payloads are capped at the same size.

## Alternatives considered

- **Postgres Changes**: it checks RLS for every subscriber on every change, scales worse, and can't route
  different visibility classes to different topics as cleanly.
- **Client-only broadcast plus a separate save**: what's shown and what's recorded could diverge.
- **Yjs CRDT with a WebSocket server (y-websocket, Liveblocks, PartyKit)**: best for collaborative text editing,
  but it needs another service. The board has its own conflict-free merge (ADR 0003), and the notes have a single
  writer.
