# Interview sessions: architecture

How a live, shared, fully recorded interview works. Decisions and their alternatives are in [`docs/adr/`](../adr/);
this document describes the system as built.

## Contents

- [Concepts](#concepts)
- [Data model](#data-model)
- [Lifecycle](#lifecycle)
- [Permission matrix](#permission-matrix)
- [Recording: the audit log](#recording-the-audit-log)
- [Realtime](#realtime)
- [The room client](#the-room-client)
- [Review and evaluation](#review-and-evaluation)
- [Security and privacy](#security-and-privacy)
- [Limits](#limits)
- [Extending it (milestone 3)](#extending-it-milestone-3)

## Concepts

| Term | Meaning |
| --- | --- |
| **Session** | One interview on one problem. Mode `solo` (candidate alone) or `peer` (with 1–2 human interviewers). |
| **Participant** | A person in a session, as `candidate` or `interviewer`. Events point at participants, not auth users. |
| **Controller** | Who runs the clock: the candidate in solo mode, interviewers in peer mode. |
| **Event** | One recorded action, e.g. a board delta, a chat message, a phase change. Append-only, hash-chained. |
| **Materialised state** | The current board, notes and phase stored on the session row, so pages load in one read. Always rebuildable from events. |
| **Evaluation** | An interviewer's scorecard or the candidate's self-assessment. Immutable once submitted. |

## Data model

```
auth.users ─┬─< interview_sessions (candidate_id) ──┬─< session_participants >── auth.users (user_id, nullable)
            │                                       ├─< session_events          (participant_id →)
            │                                       ├─< session_invites         (token_hash only)
            │                                       ├─< session_interviewer_notes (one per interviewer)
            │                                       └─< session_evaluations     (one per participant)
            └─ profiles (milestone 1; needed to create sessions, not to join one)
```

| Table | Key columns | Notes |
| --- | --- | --- |
| `interview_sessions` | `mode`, `status`, `problem_slug/version/title/snapshot`, `phase_plan`, `phase`, `phase_started_at`, `board`, `notes`, `last_seq`, `last_hash` | A CHECK keeps `status`, timestamps and phase consistent. |
| `session_participants` | `role`, `display_name`, `consented_at` | One candidate per session (partial unique index). The name becomes "Deleted user" when the account is deleted. |
| `session_events` | PK `(session_id, seq)`, `participant_id`, `actor_role`, `type`, `visibility`, `phase`, `payload`, `created_at`, `prev_hash`, `hash` | Updates are blocked by a trigger, truncation too. |
| `session_invites` | `token_hash` (unique), `expires_at`, `revoked_at`, `accepted_by` | No client access at all. |
| `session_interviewer_notes` | `(session_id, participant_id)`, `body` | Readable only by the interviewer who wrote them. |
| `session_evaluations` | `kind`, `scores` jsonb, `recommendation`, `summary`, `rubric_version`, `submitted_at` | A trigger rejects any change after submission. |

Vocabularies (phases, event types, recommendations) are defined in TypeScript and repeated in SQL. The test
`src/lib/__tests__/interview-sync.test.ts` fails if the two copies drift.

## Lifecycle

```
            create_session()                 start_session()             end_session()
 (member) ───────────────────► lobby ───────────────────────► in_progress ─────────────► completed
                                 │  accept_session_invite()       │ change_session_phase()     (completed | ended_early)
                                 │  create/revoke invites         │ record_event()
                                 │  chat                          │
                                 └──────── end_session() ───────► cancelled
```

- `end_session()` called by the controller records `completed`; called by the other side it records `ended_early`.
  Calling it again does nothing.
- Late interviewers can join a running session; invites are revoked when the session ends.
- After the end, nothing can be recorded except evaluations (and interviewers' private notes, so they can finish
  writing their evidence).

## Permission matrix

Enforced in SQL by `record_event()` and the lifecycle functions. The UI mirrors it but isn't trusted.

| Action | Candidate | Interviewer | When |
| --- | --- | --- | --- |
| Create session | ✅ (member, onboarded, ≤ 3 open) | — | — |
| Create / revoke invite | ✅ (peer mode) | — | lobby, in progress |
| Accept invite | ❌ (own session) | ✅ (signed in, no seat needed, ≤ 2 interviewers) | lobby, in progress |
| Start, change phase | solo only | peer | lobby → in progress / in progress |
| End | ✅ | ✅ | any open state |
| `chat.message` | ✅ | ✅ | lobby, in progress |
| `probe.asked` | ❌ | ✅ | in progress |
| `notes.updated` | ✅ | ❌ (reads live) | in progress |
| `board.updated` | ✅ | ✅ | in progress |
| `interviewer_note.updated` | ❌ | ✅ (private) | not cancelled |
| Save evaluation draft | ✅ self | ✅ scorecard | in progress, completed |
| Submit evaluation | ✅ | ✅ | completed only, once |

Reads (RLS): participants read their sessions, participants and `all`-visibility events; interviewers also read
`interviewers`-visibility events. Private notes are readable only by their author. Evaluations follow the release
rules in ADR 0006. Non-participants get nothing, and the app returns 404, so it doesn't reveal whether a session
exists.

## Recording: the audit log

Every write funnels into `append_session_event()`:

1. Lock the session row (`FOR UPDATE`): this serialises `seq` and the hash chain per session.
2. `seq = last_seq + 1`; `phase` = the session's current phase; `created_at` = `clock_timestamp()` truncated to
   microseconds.
3. `hash = sha256(prev_hash | session | seq | participant | type | visibility | phase | payload::jsonb::text | created_at)`;
   the first event chains from `sha256('probewise.session:' || id)`.
4. Insert the event, then update `last_seq` and `last_hash` on the session.
5. `realtime.send()` to the right topic. If the broadcast fails, the event is still recorded; clients catch up.

Payloads are rebuilt from validated fields (`{text}`, `{elements}`), so arbitrary client JSON is never stored.

**Verification**: `verify_session_log(id)` recomputes the chain and also checks it against `last_hash`, which
catches events removed from the end. The review page shows the result and the chain head; the JSON export includes
it. Tests cover a rewritten payload, an update attempt by the table owner, and truncation.

**What's recorded**

| Event | Payload |
| --- | --- |
| `session.created` | mode, problem slug/version/title, phase plan |
| `participant.joined`, `consent.given` | role, display name; consent version |
| `invite.created`, `invites.revoked` | expiry; count (never the token or its hash) |
| `session.started`, `phase.changed`, `session.ended` | from/to phase, time in previous phase; reason, final phase, duration |
| `chat.message`, `probe.asked` | text |
| `notes.updated`, `interviewer_note.updated` | full text snapshot (only when changed) |
| `board.updated` | changed Excalidraw elements (deltas) |
| `evaluation.submitted` | evaluation id, kind, SHA-256 of the submitted content |

## Realtime

| Topic | Who receives | Who sends | Carries |
| --- | --- | --- | --- |
| `session:<id>` | all participants | database (events); participants (`board.live`, presence) while the session is open | durable `event`s, ephemeral `board.live`, presence |
| `session:<id>:interviewers` | interviewers | database only | `interviewer_note.updated` events |

Authorisation is RLS on `realtime.messages` through `realtime_topic_allowed(topic, send)`. Channels are created
with `{ private: true }` after `realtime.setAuth()`.

**Ordering and recovery** (`use-session-channel.ts`):

- The client tracks `lastSeq`. Event `lastSeq + 1` is applied straight away; an older one is a duplicate and is
  dropped; a newer one means a gap, so the client reads `session_events where seq > lastSeq` and applies the
  result in order.
- A catch-up also runs on subscribe, on reconnect, on the browser's `online` event, and when the tab becomes visible
  again. A catch-up requested while one is already running schedules one more pass, so nothing committed during
  the read is missed.
- The page is server-rendered with a consistent snapshot: the session row (including `last_seq`), and events up to
  that `seq`. Everything after it arrives through catch-up.

## The room client

```
InterviewRoom (room.tsx)
├─ PhaseBar: phase stepper, server-synced timer, controller-only controls
├─ AutosaveTextarea × 2: candidate notes (shared), interviewer private notes
├─ Whiteboard (Excalidraw, next/dynamic ssr:false)
│   ├─ live: changed elements every 100 ms → broadcast 'board.live'
│   ├─ persist: changed elements every 1.5 s → record_event('board.updated'), chunked ≤ 500 elements / 200 KB
│   └─ remote: restoreElements → reconcileElements → updateScene (no undo-history entry)
├─ ChatPanel: chat, probe questions (red), phase markers
└─ InterviewerGuide: phase rubric, probes (click to stage), clarifications, numbers, signals, pitfalls, reference
```

- **Timer**: the server sends its clock time with the page; the client keeps the offset and computes phase and
  total time from server timestamps (`phase_started_at`). Every participant sees the same clock regardless of
  their local time.
- **Echo suppression**: elements applied from a remote source are marked as already sent in both delta trackers,
  so they're never re-broadcast or recorded under the wrong author. The database also ignores stale or duplicate
  deltas (it returns `null` and records nothing).
- **Ending**: before calling `end_session`, the client flushes pending board, notes and private-note saves, because
  nothing can be recorded afterwards.
- **Unload**: pending saves are flushed on `pagehide` and when the tab is hidden. A `beforeunload` warning shows
  while text is unsaved.

## Review and evaluation

`/interview/<id>/review` (server-rendered, read as the viewer):

- Integrity badge (`verify_session_log`) and the JSON export (`/interview/<id>/export`, RLS-scoped).
- Evaluation form: per-phase score 1–4 with evidence, plus a recommendation (scorecards) and a summary. Drafts are
  private; submission is final.
- Time per phase vs plan, probes, board edits and messages per phase, the path taken through the phases, and when
  the first thing was drawn. Computed by `computeMetrics()` from the log.
- Final board (read-only Excalidraw), notes, transcript, the reference outline from the problem guide, and the full
  event table.

## Security and privacy

- **Least privilege**: clients have `SELECT` only. All writes go through `security definer` functions with
  `search_path = ''`. Internal functions (`append_session_event`, hash helpers, `merge_board`) aren't executable by
  `authenticated`.
- **Confidential guide**: problem guides live in a `server-only` module and are passed to the room only when the
  viewer is an interviewer. The candidate's page payload never contains them.
- **Invites**: 256-bit random tokens; only their SHA-256 is stored; single use; 7-day expiry; revoked on renewal
  or when the session ends; malformed tokens are rejected before any database call.
- **Seats**: invite and room paths skip `claim_seat()` after sign-in, so interviewers never take a candidate seat
  or land on the waitlist.
- **Consent**: required to create or join a session; stored on the participant and as an event.
- **Deletion**: a candidate deleting their account removes their sessions entirely. An interviewer deleting theirs
  is anonymised ("Deleted user"); the log stays verifiable because events reference participant ids.
- **Error hygiene**: database messages are shown only for our own SQLSTATEs; anything else becomes a generic
  message.

## Limits

| Limit | Value | Where |
| --- | --- | --- |
| Open sessions per candidate | 3 | `create_session` |
| Interviewers per session | 2 | `create_session_invite`, `accept_session_invite` |
| Events per session | 10,000 | `append_session_event` |
| Event payload | 256 KB | CHECK |
| Board elements per update / total | 500 / 3,000 | `record_event` |
| Board size | 2 MB | CHECK |
| Notes / private notes | 20,000 chars | CHECK, `record_event` |
| Chat / probe | 2,000 / 1,000 chars | `record_event` |
| Evidence per phase / summary | 2,000 / 5,000 chars | `save_evaluation`, zod |
| Invite lifetime | ≤ 7 days | `create_session_invite` |

## Extending it (milestone 3)

- **AI interviewer**: join as an `interviewer` participant (a service identity) and call the same functions:
  `probe.asked`, `change_session_phase`, `save_evaluation`. The permission matrix and the log don't change.
- **Automated scoring**: `computeMetrics()` plus the event log (with board deltas) is the input. Human scorecards
  (`rubric_version`) give labelled data to calibrate against.
- **Replay**: board deltas in `seq` order rebuild the board at any point (`mergeBoard`). A scrubber UI only needs to
  fold events up to the selected `seq`.
