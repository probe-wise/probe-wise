# Milestone 2 progress

Live tracker for [PLAN.md](./PLAN.md). Newest log entries first.

> **Superseded 2026-10-31:** the product became a company platform. The room, audit log and realtime design carry
> over; modes, interviewer invites and self-assessment are gone. Current tracker:
> [`docs/company-platform/PROGRESS.md`](../company-platform/PROGRESS.md).

## Status board

| # | Workstream | Status | Notes |
| --- | --- | --- | --- |
| W1 | Plan, ADRs, architecture doc | ✅ done | PLAN, ADRs 0001–0006, `docs/architecture/interview-sessions.md` |
| W2 | Migration + DB tests | ✅ done | `20261030120000_m2_interview_sessions.sql`, 37 DB tests |
| W3 | Problem bank, rubric, phases | ✅ done | 30 problems, rubric v1, metrics, board merge; unit tests |
| W4 | Server layer | ✅ done | Session DAL, Server Actions, JSON export route; seat-free sign-in for invitees |
| W5 | Room UI | 🟡 built, needs live test | Lobby, invite, phase bar/timer, Excalidraw board, notes, chat/probes, guide, private notes, presence. Not yet run against a live Supabase project |
| W6 | Review UI, metrics, integrity | 🟡 built, needs live test | Integrity badge, time per phase, transcript, final board, scorecards, audit table, export |
| W7 | Dashboard + problem pages | ✅ done | `/problems`, `/problems/[slug]`, `/interview`; dashboard queue + sessions |
| W8 | Docs | ✅ done | README (setup step for Realtime, how sessions work, edge cases, limitations), architecture doc |

Legend: ⚪ not started · 🟡 in progress · ✅ done · ⛔ blocked

**Checks (2026-10-30):** `npm test` 171 passed (102 → 171) · `npm run lint` clean · `npm run typecheck` clean ·
`npm run build` succeeds · production server smoke-tested without Supabase (protected routes redirect, export → 401).

## Next steps

1. **Live end-to-end test** (blocks calling W5/W6 done): create a Supabase project or run `supabase start`, apply
   both migrations, turn off Realtime public access, then run a peer session in two browsers (one as an invited
   non-member). Check live board sync, probes, phase changes, reconnecting (toggle the network), ending, both
   evaluations and the release order, and the export. Then regenerate `database.types.ts`.
2. Add Playwright tests for that flow once a test project exists.
3. Follow-ups from the limitations list: self-host Excalidraw fonts, a `problem_catalog` table, a replay scrubber,
   anchoring the chain head on session end.

## Log

### 2026-10-30
- **First live run, two fixes:** the sessions list failed with PGRST201 (`session_interviewer_notes` gives PostgREST
  a second path between participants and sessions; the embed now names `session_participants_session_id_fkey`).
  Runtime prefetching hit Supabase's `Date.now()` token check during prerender; the cookie-bound client now calls
  `connection()` first.
- **Found and fixed:** post-login routing called `claim_seat()` for everyone, so an invited interviewer signing in
  would have taken one of the 100 seats or been sent to the waitlist instead of the invite. Sign-ins headed for
  `/interview/*` now skip the seat claim (`isSeatFreePath`, tested).
- W5–W7: room UI, review page, problem pages, sessions list, dashboard integration. Ordered realtime delivery with
  gap and reconnect catch-up (catch-up reruns if called mid-flight, so no event is skipped). Board sync on two paths
  (live broadcast plus throttled persistence) with echo suppression. Pending saves are flushed before ending. The
  timer follows server time.
- Lint (React Compiler rules) caught self-referencing callbacks, a component created during render and setState in
  an effect; all fixed.
- Docker isn't running on this machine, so no local Supabase stack. A live E2E test is the top next step.
- W4: session DAL (reads run as the user, so RLS decides), Server Actions for create/invite/join/evaluate, and an
  RLS-scoped JSON export. In-room actions are direct RPCs (authorised by the database, lower latency).
- W3: problem bank (30 problems: 2 per domain + 6 classics), each with a confidential interviewer guide. Rubric v1
  (1–4 per phase, 4-point recommendation), session metrics computed from the log, and a board merge rule shared with
  SQL. `server-only` is stubbed in Vitest so server modules can be unit-tested. Removed `problem-previews.ts`, which
  the bank replaces.
- W2: migration with sessions, participants, invites, the hash-chained `session_events`, private interviewer notes,
  evaluations, RLS and Realtime policies. 37 database tests pass: lifecycle, permission matrix, RLS isolation,
  private-note leakage, tamper detection, immutability, evaluation release rules and account deletion. Found and
  fixed a bug in the test's own expiry setup on the first run; the schema needed no changes.
- Removed a no-op "revoke invites on start" hook from the migration: late interviewers can still join a running
  session.
- Started milestone 2 on `feature/phase1-m2-interview-room`, branched from `feature/phase1-foundation` (milestone 1
  is not merged to `main` yet).
- Wrote the plan with assumptions A1–A5. The interviewer is a human for now, and recording covers actions, not
  audio/video.
