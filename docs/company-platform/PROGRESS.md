# Company platform: plan and progress

Probewise moves from candidate self-practice to a platform companies use to interview candidates. Newest log
entries first. Decisions: [ADR 0007](../adr/0007-company-workspaces.md),
[0008](../adr/0008-candidate-access-by-link.md), [0009](../adr/0009-ai-assessment.md).

## Decisions confirmed with the product owner (2026-10-31)

| Question | Decision |
| --- | --- |
| How does the candidate get in? | A one-time link, no account (Supabase anonymous session) |
| Seat cap, waitlist, candidate profile? | Removed. Sign-up creates a company workspace; candidate details live on the candidate record |
| AI assessment? | Claude, advisory, generated on request after the interview, visible to the company only |
| Who interviews? | Workspace members, assigned when scheduling. Only the candidate gets a link |

## Status board

| # | Workstream | Status | Notes |
| --- | --- | --- | --- |
| C1 | Migration + DB tests | ✅ done | `20261031000000_company_platform.sql`; 39 DB tests |
| C2 | Server layer | ✅ done | DAL (viewer, membership), routes, proxy (candidates confined to the room), actions for org, candidates, interview |
| C3 | Team UI | ✅ built | Onboarding (create workspace), team page, invites, roles, account |
| C4 | Candidates + scheduling UI | ✅ built | List/search, add/edit/delete, schedule with problem + interviewers + time |
| C5 | Room changes | 🟡 built, needs live test | Interviewer join gate, candidate link panel (lobby and mid-interview), candidate thank-you screen |
| C6 | Scorecards + AI assessment | 🟡 built, needs live test | Seven aspects, comparison table, Claude (`claude-opus-5-5`, structured output, server-side fallback) |
| C7 | Docs | ✅ done | README, USAGE_GUIDE, architecture doc, ADRs 0007–0013 |
| C8 | Round types: coding + behavioural | 🟡 built, needs live test | Shared CodeMirror editor (candidate types, live broadcast + recorded `code.updated`), conversation-centred behavioural room, 4 coding problems + 3 behavioural sets |
| C9 | Custom problems + rubrics | 🟡 built, needs live test | `problems`, `rubrics`, rubric snapshot per session, defaults per round type |
| C10 | Loops | 🟡 built, needs live test | Multi-round scheduling, loop summary page |
| C11 | Email | 🟡 built, untested with a provider | Resend or SMTP via `EMAIL_PROVIDER`; team invites, candidate links, .ics |
| C12 | Calendar | 🟡 built, untested with Google | Google Calendar (default, Meet link) or .ics, per workspace; encrypted tokens |
| — | Audio/video | ⚪ future scope | Per the product owner, 2026-11-01 |

**Checks (2026-11-01):** `npm test` 164 passed (55 DB tests) · `npm run lint` clean · `npm run typecheck` clean ·
`npm run build` succeeds.

## Next steps

0. Google Calendar and email against real accounts: create the OAuth client, connect a calendar, schedule with a
   time, check the event, Meet link and invites; cancel and check they're withdrawn. Same with Resend or SMTP.
1. **Live end-to-end test** (blocks calling C5/C6 done). On a project you're happy to reset, apply the new
   migration (it drops the old profiles and practice sessions), turn on **Anonymous sign-ins**, then follow
   "Verify your setup" in the usage guide: workspace, team invite, candidate, schedule, candidate link in a private
   window, a full interview, scorecard, AI assessment. Then regenerate `database.types.ts`.
2. Playwright tests for that flow.
3. Transactional email for team invites and candidate links.
4. Follow-ups: a `problem_catalog` table, multi-workspace accounts, CAPTCHA on anonymous sign-ins, a replay scrubber.

## Log

### 2026-11-01
- Product owner chose: email configurable (Resend or SMTP), Google Calendar by default but configurable (.ics, off),
  audio/video as future scope, and loops with system design, behavioural and coding rounds.
- New migration `20261101000000_rounds_rubrics_loops_calendar.sql` (additive): round types with their own phases
  and default aspects, `problems`, `rubrics`, `interview_loops`, rubric snapshots on sessions, code columns,
  calendar columns and `calendar_connections`. 16 new DB tests.
- Tests caught an aspect-key bug: accented names became `e_nergie` (NFKD left combining marks); fixed.
- Older vocabulary tests were matching definitions that moved to the new migration; they now read the latest
  function body.
### 2026-10-31
- New migration replaces the seat cap, waitlist and profile with workspaces (`organizations`, `org_members`,
  email-bound `org_invites`), `candidates`, and a rebuilt session schema: assigned/joined interviewers,
  `candidate_links`, interviewer-only scorecards keyed by aspect (six phases + communication), and
  `session_ai_assessments` writable only by `service_role`.
- Tests caught: a CHECK calling `email_valid()` needed execute for `authenticated`; an SQL function created before
  the table it reads; the teardown had to drop tables before the functions their policies use. Fixed in the
  migration. Two bugs were in the tests themselves (an expiry setup that read the old `created_at`; an outsider
  seeing their own workspace).
- Candidates read the company name through a narrow policy (`is_org_candidate`), nothing else about the workspace.
- AI assessment: prompt built from the recording (transcript with times, notes, a text reading of the board,
  timings, the guide's grading anchors); private notes and scorecards are excluded for independence. Output
  validated with zod, clipped to DB limits, recorded in the hash chain.
- Did **not** apply the migration to the Supabase project in `.env`: it's destructive and needs the owner's go-ahead.
