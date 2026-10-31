# Architecture decision records

One file per significant decision, in the lightweight [MADR](https://adr.github.io/madr/) style: context, decision,
consequences, alternatives. An accepted ADR isn't edited to change the decision; a new ADR supersedes it.

Milestone 1 decisions live in the README's decision log. Decisions from milestone 2 onwards are recorded here.

| ADR | Title | Status |
| --- | --- | --- |
| [0001](0001-append-only-hash-chained-event-log.md) | Record sessions as an append-only, hash-chained event log | Accepted |
| [0002](0002-realtime-via-database-broadcast.md) | Realtime via Supabase Broadcast sent from the database, on private channels | Accepted |
| [0003](0003-excalidraw-whiteboard.md) | Excalidraw for the shared whiteboard | Accepted |
| [0004](0004-problem-bank-in-code-snapshotted.md) | Problem bank in code, snapshotted into each session | Accepted |
| [0005](0005-participants-and-roles.md) | Session participants, roles and invites | Superseded in part by 0007, 0008 |
| [0006](0006-evaluation-release-rules.md) | Scorecards: immutable once submitted, released without anchoring | Accepted, amended |
| [0007](0007-company-workspaces.md) | Companies run interviews: workspaces, members and candidate records | Accepted |
| [0008](0008-candidate-access-by-link.md) | Candidates join by a one-time link, without an account | Accepted |
| [0009](0009-ai-assessment.md) | An advisory AI assessment, generated from the recording | Accepted |
| [0010](0010-round-types.md) | Three round types: system design, coding, behavioural | Accepted |
| [0011](0011-custom-problems-and-rubrics.md) | Workspaces write their own problems and rubrics; sessions snapshot the rubric | Accepted |
| [0012](0012-interview-loops.md) | Loops: several rounds for one candidate, summarised together | Accepted |
| [0013](0013-email-and-calendar.md) | Configurable email; Google Calendar by default, .ics as the fallback | Accepted |
