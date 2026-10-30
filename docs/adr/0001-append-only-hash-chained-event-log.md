# 0001. Record sessions as an append-only, hash-chained event log

- Status: Accepted
- Date: 2026-10-30

## Context

Every interview session must be recorded and auditable so it can be reviewed, analysed and scored, by people now
and by the AI interviewer and scorer in milestone 3. Reviewers need to trust that the record shows what actually
happened: a candidate shouldn't be able to quietly change their notes after the interview, and nobody should be able
to edit an interviewer's question after the fact.

## Decision

- Every recorded action is a row in `public.session_events`, keyed by `(session_id, seq)` with a gap-free per-session
  sequence number.
- Rows are written by **one** `security definer` function (`_append_event`), reached through narrower public
  functions (`record_event`, `start_session`, `end_session`, …) that check the caller's role and the session state.
  Clients have no `insert`, `update` or `delete` grants on the table.
- Each row stores `prev_hash` and `hash = sha256(prev_hash | seq | participant | type | visibility | payload |
  created_at)`. The first row chains from `sha256(session_id)`. `verify_session_log(session_id)` recomputes the
  chain in SQL and reports the first bad `seq`.
- A trigger rejects `UPDATE` on the table for every role, including the service role, as defence in depth.
- Current state (board, notes, phase) is **materialised** onto `interview_sessions` in the same transaction, so pages
  load in one read. The log stays the source of truth; any state can be rebuilt by replaying it.

## Consequences

- Reviews, metrics and milestone 3's AI can work from one ordered record.
- Tampering is *evident*, not impossible: a database superuser could rewrite the whole chain. Anchoring the chain head
  outside the database (e.g. signing it on session end) is a possible follow-up.
- Deleting is still possible, on purpose: deleting the candidate's account cascades and removes the record (privacy
  over permanence, consistent with milestone 1).
- Write volume is bounded by throttling on the client and caps in the database (256 KB per event, 10,000 events per
  session).

## Alternatives considered

- **Mutable tables plus `updated_at`**: no history, nothing to replay.
- **Postgres audit triggers (pgaudit / a generic audit table)**: these record row changes, not intent ("interviewer
  asked X in deep-dive"), and they're harder to replay.
- **External event store (Kafka, EventStoreDB)**: overkill for 100 users and adds infrastructure.
