# 0004. Problem bank in code, snapshotted into each session

- Status: Accepted
- Date: 2026-10-30

## Context

The problem bank has a candidate-facing prompt and a confidential interviewer guide (hidden requirements, probes,
rubric signals). Problems will be edited over time, but a session reviewed weeks later must show the version that
was actually asked.

## Decision

- Problems live in `src/lib/problems/` as typed TypeScript in a `server-only` module, reviewed in pull requests and
  checked by tests.
- Each problem has a `version`. Creating a session stores `problem_slug`, `problem_version`, `problem_title` and a
  **snapshot** of the candidate-facing prompt on the session row.
- The interviewer guide is rendered on the server, and only for interviewers, never sent to the candidate's browser.

## Consequences

- Content changes get code review, history and type checking at no extra cost.
- The session function can't verify that a snapshot matches the bank, because the bank isn't in the database. A
  member calling the RPC directly could practise against a made-up prompt; that only affects them. Fix later by
  syncing a `problem_catalog` table (slug, version, content hash) in milestone 3.

## Alternatives considered

- **Problems table edited in SQL/admin UI**: needs an admin UI and gives up code review. Revisit when non-engineers
  write problems.
- **A CMS**: overkill for 30 problems.
