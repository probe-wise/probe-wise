# Interview sessions: architecture

How a company runs a live, shared, fully recorded interview, and how it's graded. Decisions and their alternatives are in [`docs/adr/`](../adr/);
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
- [Extending it](#extending-it)

## Concepts

| Term | Meaning |
| --- | --- |
| **Workspace** | A company's account (`organizations`). Members are `admin` or `interviewer` (ADR 0007). |
| **Candidate** | A record the workspace manages (`candidates`): name, email, role, level, notes. Not an account. |
| **Session** | One interview (round) of one candidate on one problem, with 1–2 interviewers. Has a round type: system design, coding or behavioural (ADR 0010). |
| **Loop** | Several sessions for one candidate, summarised together (ADR 0012). |
| **Rubric snapshot** | The copy of the rubric a session is graded on, taken when it's scheduled (ADR 0011). |
| **Participant** | A person in a session, as `candidate` or `interviewer`. Interviewers are *assigned* at scheduling and *join* when they consent. Events point at participants, not auth users. |
| **Candidate link** | The one-time link that lets the candidate in without an account (ADR 0008). |
| **Event** | One recorded action, e.g. a board delta, a chat message, a phase change. Append-only, hash-chained. |
| **Materialised state** | The current board, notes and phase stored on the session row, so pages load in one read. Always rebuildable from events. |
| **Scorecard** | An interviewer's grade on every aspect (six phases plus communication), a recommendation and a summary. Immutable once submitted. |
| **AI assessment** | An advisory scorecard Claude writes from the recording (ADR 0009). |

## Data model

```
organizations ─┬─< org_members >── auth.users
               ├─< org_invites            (token_hash only, bound to an email)
               ├─< problems, rubrics      (the workspace's own library, ADR 0011)
               ├─< interview_loops ─< interview_sessions.loop_id
               └─< candidates ─< interview_sessions ─┬─< session_participants >── auth.users (nullable; anonymous for candidates)
                                                     ├─< candidate_links        (token_hash only)
                                                     ├─< session_events         (participant_id →)
                                                     ├─< session_interviewer_notes (one per interviewer)
                                                     ├─< session_evaluations    (one per interviewer)
                                                     └─  session_ai_assessments (at most one)
```

| Table | Key columns | Notes |
| --- | --- | --- |
| `organizations` | `name` | Admins rename it. Candidates who've joined one of its interviews can read the name. |
| `org_members` | `(org_id, user_id)`, `role`, `display_name`, `email` | One workspace per account (`unique (user_id)`). |
| `org_invites` | `email`, `role`, `token_hash`, `expires_at`, `accepted_at`, `revoked_at` | Admins read everything but `token_hash`. |
| `candidates` | `full_name`, `email` (unique per workspace), `role_title`, `seniority`, `notes` | Plain writes under RLS; admins delete (cascades to interviews). |
| `interview_sessions` | `org_id`, `candidate_id`, `round_type`, `rubric` (snapshot), `loop_id`, `scheduled_at`, `status`, `problem_*` (+ `problem_id` for custom), `phase_plan`, `phase`, `board`, `code`, `code_language`, `notes`, `calendar_event_id`, `meeting_url`, `last_seq`, `last_hash` | CHECKs keep status and phase consistent, and phases and the plan within the round type. |
| `problems` | `round_type`, `title`, `prompt`, `levels`, `language`, `starter_code`, `guide`, `version`, `archived_at` | Members write; never deleted; version bumps on edit. |
| `rubrics` | `round_type`, `name`, `aspects`, `is_default`, `archived_at` | Admins write; one default per round type. |
| `interview_loops` | `candidate_id`, `name` | Same workspace and candidate as its rounds. |
| `calendar_connections` | `user_id`, `account_email`, `refresh_token_ciphertext` | Service role only (ADR 0013). |
| `session_participants` | `role`, `display_name`, `consented_at`, `joined_at` | One candidate per session. `joined_at` null = assigned interviewer who hasn't entered yet. |
| `candidate_links` | `token_hash`, `expires_at`, `revoked_at`, `accepted_by` | No client access. |
| `session_events` | PK `(session_id, seq)`, `participant_id`, `actor_role` (`candidate`, `interviewer`, `member`, `system`), `type`, `visibility`, `payload`, `prev_hash`, `hash` | Updates and truncation are blocked by triggers. |
| `session_interviewer_notes` | `(session_id, participant_id)`, `body` | Readable only by the interviewer who wrote them. |
| `session_evaluations` | `scores` jsonb keyed by aspect, `recommendation`, `summary`, `rubric_version` (2), `submitted_at` | A trigger rejects any change after submission. |
| `session_ai_assessments` | `status`, `model`, `scores`, `recommendation`, `summary`, `strengths`, `concerns`, `error` | Written by `service_role` only. |

Vocabularies (phases, aspects, event types, recommendations, roles, levels) are defined in TypeScript and repeated
in SQL. `src/lib/__tests__/interview-sync.test.ts` and `profile-options-sync.test.ts` fail if the copies drift.

## Lifecycle

```
 member: create_session(candidate, problem, interviewers)
        │
        ▼                 join_session()  (interviewers consent)
      lobby ◄──────────── create_candidate_link() → candidate opens /join/<token> → accept_candidate_link()
        │ start_session() (interviewer, once the candidate is in)
        ▼
   in_progress ── change_session_phase() · record_event() · new candidate links still work
        │ end_session()
        ▼
    completed ── save_evaluation() (interviewers) · AI assessment (server)
 (lobby → cancelled by any member or interviewer)
```

- `end_session()` by an interviewer records `completed`; by the candidate, `ended_early`. Calling it again does
  nothing. Members who aren't in the room can cancel from the lobby but not end a running interview.
- Interviewers can join a running interview (up to two joined). Candidate links are revoked when it ends.
- After the end, nothing can be recorded except scorecards, private notes and the AI assessment.

## Permission matrix

Enforced in SQL by the session functions. The UI mirrors it but isn't trusted.

| Action | Candidate | Interviewer (joined) | Member (not in the room) | When |
| --- | --- | --- | --- | --- |
| Schedule an interview | — | ✅ | ✅ | — |
| Join as interviewer | — | (assigned: consent) | ✅ while < 2 joined | lobby, in progress |
| Create / revoke candidate link | ❌ | ✅ | ✅ | lobby, in progress |
| Accept candidate link | ✅ (anyone not in the workspace) | ❌ | ❌ | lobby, in progress |
| Start, change phase | ❌ | ✅ | ❌ | lobby → in progress / in progress |
| Cancel (lobby) / end (running) | ❌ / ✅ early | ✅ / ✅ | ✅ / ❌ | open states |
| `chat.message` | ✅ | ✅ | ❌ | lobby, in progress |
| `probe.asked` | ❌ | ✅ | ❌ | in progress |
| `notes.updated` | ✅ | ❌ (reads live) | ❌ | in progress |
| `board.updated` (system design) | ✅ | ✅ | ❌ | in progress |
| `code.updated` (coding) | ✅ | ❌ (watches live) | ❌ | in progress |
| `interviewer_note.updated` | ❌ | ✅ (private) | ❌ | not cancelled |
| Save scorecard draft / submit | ❌ | ✅ / ✅ once | ❌ | in progress, completed / completed |
| Request AI assessment | ❌ | ✅ | ✅ | completed |

Reads (RLS): joined participants read their session, its participants and `all`-visibility events; the whole
workspace reads the workspace's sessions and every event. Candidate records, scorecards and AI assessments are
never readable by the candidate. Submitted scorecards and the AI assessment are readable by the workspace, except
by an interviewer who took part and hasn't submitted yet (ADR 0006). Other workspaces get nothing, and the app
returns 404.

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
| `session.created` | who scheduled it, problem slug/version/title, phase plan, interviewers, scheduled time |
| `participant.joined`, `consent.given` | role, display name, `rejoined` (candidate switched device); consent version |
| `candidate_link.created`, `candidate_links.revoked` | expiry, who; count (never the token or its hash) |
| `session.started`, `phase.changed`, `session.ended` | from/to phase, time in previous phase; reason, final phase, duration |
| `chat.message`, `probe.asked` | text |
| `notes.updated`, `interviewer_note.updated` | full text snapshot (only when changed) |
| `board.updated` | changed Excalidraw elements (deltas), system design only |
| `code.updated` | full code text and language (candidate only, coding only) |
| `evaluation.submitted` | evaluation id, SHA-256 of the submitted content (interviewers only) |
| `ai_assessment.completed` | model, SHA-256 of the content (interviewers only, written by the server) |

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

`/interview/<id>/review` (server-rendered, read as the viewer, hiring team only):

- Integrity badge (`verify_session_log`) and the JSON export (`/interview/<id>/export`, RLS-scoped, team only).
- **Scorecard**: each joined interviewer scores every aspect (six phases plus communication) 1–4 with evidence,
  picks a recommendation and writes a summary. Drafts are private; submission is final.
- **Comparison**: once unlocked, every submitted scorecard and the AI assessment side by side, per aspect, with a
  "split" marker where scores differ by two or more.
- **AI assessment** (ADR 0009): generated on request; the card shows its scores with evidence, strengths, concerns
  and what it couldn't see.
- Time per phase vs plan, probes, board edits and messages per phase, the path through the phases, the final
  board, notes, transcript, the reference outline and the full event table.

The candidate's room ends with a thank-you from the company; there's no review page for them.

## Security and privacy

- **Least privilege**: clients have `SELECT` on session tables only; candidates get column-limited writes under RLS.
  All session writes go through `security definer` functions with `search_path = ''`. Internal functions aren't
  executable by `authenticated`; AI assessment writers are executable by `service_role` only.
- **Workspace isolation**: every policy goes through `is_org_member`, `session_org_member` or `session_role`.
  Tested across two workspaces.
- **Candidates**: an anonymous session that only opens the room (proxy, DAL and SQL all check). They never receive
  the interviewer guide (server-only module), private notes, candidate records, scorecards or the AI assessment.
- **Links**: 256-bit random tokens; only SHA-256 stored; single use; candidate links last 24 hours and are revoked
  when replaced or when the interview ends; team invites last 7 days and are bound to an email address.
- **Consent**: recorded for every participant (candidate on join, interviewer on entering) as a column and an event.
- **Deletion**: deleting a candidate (admins) removes their interviews. An interviewer deleting their account is
  anonymised ("Deleted user") and the log stays verifiable. The last member takes the workspace with them; the last
  admin of a team must hand over first.
- **AI**: only the recorded, candidate-visible material is sent to the Claude API. No private notes or scorecards.
- **Error hygiene**: database messages are shown only for our own SQLSTATEs; anything else becomes a generic
  message.

## Limits

| Limit | Value | Where |
| --- | --- | --- |
| People per workspace | 50 | `create_org_invite` |
| Open interviews per candidate | 3 | `create_session` |
| Interviewers per session | 2 assigned, 2 joined | `create_session`, `join_session` |
| Events per session | 10,000 | `append_session_event` |
| Event payload | 256 KB | CHECK |
| Board elements per update / total | 500 / 3,000 | `record_event` |
| Board size | 2 MB | CHECK |
| Notes / private notes | 20,000 chars | CHECK, `record_event` |
| Chat / probe | 2,000 / 1,000 chars | `record_event` |
| Evidence per phase / summary | 2,000 / 5,000 chars | `save_evaluation`, zod |
| Candidate link lifetime | 24 h default, ≤ 7 days | `create_candidate_link` |
| Team invite lifetime | 7 days | `create_org_invite` |

## Extending it

- **AI interviewer**: join as an `interviewer` participant (a service identity) and call the same functions:
  `probe.asked`, `change_session_phase`, `save_evaluation`. The permission matrix and the log don't change.
- **Calibration**: human scorecards and the AI assessment share `rubric_version`, so agreement per aspect can be
  tracked across interviews.
- **Replay**: board deltas in `seq` order rebuild the board at any point (`mergeBoard`). A scrubber UI only needs to
  fold events up to the selected `seq`.
- **Email**: candidate links and team invites are copied by hand today; transactional email can send them.
