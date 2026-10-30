# Milestone 2: problem bank and collaborative interview room

Status: **in progress** (see [PROGRESS.md](./PROGRESS.md) for the live tracker).
Branch: `feature/phase1-m2-interview-room` (stacked on `feature/phase1-foundation`).

## Goal

A candidate picks a system design problem and runs a timed interview in a **shared, live session**. A second person
can join as the **interviewer** and see the same board, notes and timer in real time. **Everything that happens in
the session is recorded** in a tamper-evident audit log, so the session can be replayed, reviewed, analysed and
scored against a rubric afterwards.

## Assumptions (confirm or correct)

| # | Assumption | Why |
| --- | --- | --- |
| A1 | The interviewer in milestone 2 is a **human** (a peer, mentor or friend) invited by link. | The AI interviewer is milestone 3. The participant model has an `interviewer` role that the AI will join through, so nothing gets rebuilt. |
| A2 | "Recorded" means every **action** is recorded: board edits, notes, chat, interviewer probes, phase changes, joins, consent, scores. **Not audio/video.** | A/V needs a media server (LiveKit/Daily) and storage, plus heavier consent rules. Planned as a follow-up. Participants can use any call tool alongside the room. |
| A3 | An invited interviewer must **sign in** but does **not** need one of the 100 seats. | Accountability for an audited record needs an identity, but a friend who interviews you shouldn't take a candidate's seat. |
| A4 | Solo mode stays available: a candidate can practise alone with the timer, board and self-assessment. | Until milestone 3 there's no AI, and not everyone has a peer available. |
| A5 | Records are kept until the candidate deletes the session's owner account. | Matches milestone 1's "delete cascades" privacy stance. A retention policy is listed as follow-up work. |

## Scope

### In
1. **Problem bank**: 30 problems (2 per domain + 6 general classics), tagged by domain, role and level. Each one has
   a prompt the candidate sees, plus an interviewer guide the candidate never sees (hidden requirements, scale
   numbers, probes for each phase, signals for each rubric item, common pitfalls).
2. **Sessions**: create (solo or peer), lobby, start, a phase timer (requirements → estimation → API & data model →
   high-level design → deep dive → trade-offs), end or cancel.
3. **Invites**: one-time, expiring, revocable link for interviewers. Only a hash of the token is stored.
4. **Live collaboration**: a shared whiteboard (Excalidraw, multiple people drawing at once), candidate notes,
   chat, interviewer "probe" questions, who's online, a timer synced to the server.
5. **Audit log**: append-only, hash-chained `session_events` holding every recorded action, written by one
   database function that checks permissions. It can be verified, and both participants can export it as JSON.
6. **Interviewer workspace**: an interviewer guide and private notes that the candidate can't see, even through
   the API.
7. **Evaluation**: an interviewer scorecard (1–4 score and evidence for each phase, an overall recommendation) and
   a candidate self-assessment. A submitted scorecard can't be changed, and the scorecards are released so nobody's
   score anchors anyone else's.
8. **Review page**: a phase timeline against the planned time, metrics, the event log, the final board and notes,
   the chat transcript, scorecards, an integrity check and an export.
9. Dashboard integration: problems queued for the member, active sessions, and past sessions.

### Out (later)
- Audio/video and its recording (follow-up, needs a media provider decision).
- AI interviewer and automated scoring (milestone 3; consumes this event log).
- Admin/moderation views, retention jobs, emailing invites (milestone 4).
- Timeline replay scrubber that animates the board (the data supports it; the UI comes later).

## Architecture summary

Full design: [`docs/architecture/interview-sessions.md`](../architecture/interview-sessions.md).
Decisions: [`docs/adr/`](../adr/).

```
 Browser (candidate)                Supabase                               Browser (interviewer)
 ───────────────────               ──────────────────────────────          ─────────────────────
 rpc record_event() ──────────────► security-definer function
                                    • permission matrix (role × type × status)
                                    • append to session_events (seq, hash chain)
                                    • update materialised state (board / notes / phase)
                                    • realtime.send() to private topic ─────────────► on 'event' → apply
 channel 'session:<id>' ◄──────────────────────────────────────────────────────────── (and back)
 broadcast 'board.live' (ephemeral, low-latency) ◄──── Realtime (RLS on realtime.messages) ────►
 presence (who's online)
```

- **The database is the authority.** Clients can't write tables directly. Every write is a function that checks
  who the caller is, their role in the session and the session state.
- **Durable before visible.** Recorded events are broadcast from inside the same transaction that stores them.
  Seeing an event live means it's already in the log.
- **Live drawing stays smooth.** Board deltas are also broadcast directly between clients (throttled, never
  stored) and saved through `record_event` about every 1.5 s. Both paths merge the same way, by element version,
  so applying one twice or in a different order changes nothing.

## Work breakdown and acceptance criteria

| # | Workstream | Done when |
| --- | --- | --- |
| W1 | Plan, ADRs, architecture doc | Docs merged; assumptions listed. |
| W2 | Migration: sessions, participants, invites, events, interviewer notes, evaluations, RLS, realtime policies | DB tests cover lifecycle, permission matrix, RLS isolation, hash chain, immutability, evaluation visibility. |
| W3 | Problem bank + rubric + phases | 30 problems; tests check structure, unique slugs, valid domains and levels, and that the phase list matches SQL. |
| W4 | Server layer: DAL, Server Actions (create, invite, join, start, end, evaluate), export route | Every action re-authorises; errors map to plain messages. |
| W5 | Room UI: lobby, phase bar + timer, board, notes, chat/probes, presence, interviewer panel | Two browsers see each other's changes; reconnecting catches up from the log. |
| W6 | Review UI + metrics + integrity check | Completed session shows timeline, metrics, transcript, scorecards; chain verifies. |
| W7 | Dashboard + problem pages | Members can browse, start and resume sessions. |
| W8 | Docs: README, setup (Realtime auth), edge cases, limitations | README reflects milestone 2; PROGRESS shows final state. |

## Risks

| Risk | Mitigation |
| --- | --- |
| Event volume (board/notes) bloats the log | Throttled persistence, payload caps (256 KB/event, 10k events/session), notes saved as snapshots only when changed. |
| A client forges a problem snapshot when creating a session | Snapshot built by the server; a forged one only affects the forger's own practice. Logged as a known limitation; a DB problem catalog in milestone 3 closes it. |
| Realtime message drops | Every event has a per-session `seq`; gaps trigger a catch-up read from the log. Reconnects do the same. |
| Interviewer anchoring / candidate gaming scores | Scorecards stay hidden until submitted, submitted ones are immutable, and interviewers see other scorecards only after submitting their own. |
| Private interviewer data leaking to the candidate | Separate visibility class plus RLS, a separate realtime topic, and an interviewer guide rendered only on the server. Tested. |
