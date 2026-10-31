# 0010. Three round types: system design, coding, behavioural

- Status: Accepted
- Date: 2026-11-01

## Context

Hiring loops have more than system design rounds. Teams asked for coding and behavioural rounds in the same tool, so
the candidate gets one experience and the team one summary.

## Decision

- Each session has a `round_type`: `system_design`, `coding` or `behavioural`. A round type defines its phases (the
  timer), the time per phase by level, a built-in rubric, general follow-up questions per phase, and the room's main
  panel. One TypeScript definition (`src/lib/interview/rounds.ts`), repeated in SQL (`round_types()`,
  `round_phases()`, `default_aspects()`, `code_languages()`) and checked by tests.
- **System design**: the shared Excalidraw whiteboard, as before.
- **Coding**: a shared CodeMirror editor. The **candidate types; interviewers watch**. Typing is broadcast live
  (~150 ms, ephemeral) and saved as `code.updated` events (~1.2 s after typing stops), with the current text and
  language materialised on the session. Code is **not executed**.
- **Behavioural**: no board or editor; the conversation is the main panel, and the guide holds the question set.
- The database enforces the room: board events only in system design rounds, code events only in coding rounds,
  phases only from the round's own list.

## Consequences

- Phase values are unique across round types, so labels can be looked up without knowing the round.
- Pair programming (interviewer edits too) would need a CRDT; the single-writer model avoids conflicts for now.
- Running code needs a sandbox; out of scope.

## Alternatives considered

- **Separate apps per round type**: three permission models and three logs to keep verifiable.
- **Collaborative editing (Yjs)**: more moving parts for a case most interviews don't need.
