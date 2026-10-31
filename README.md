# Probewise

Structured technical interviews for hiring teams: system design, coding and behavioural rounds. A company adds its
candidates, schedules a round or a whole loop with its own interviewers, and sends the candidate a link when the
interview starts. Interviewers share a live whiteboard or code editor with the candidate, follow a private guide,
and grade every aspect of a rubric independently. Invites go out by email and onto calendars, rubrics and problems
can be the company's own, and an advisory AI assessment of each recording is available afterwards.

> **Status of this branch (`feature/company-platform`)**: the product moved from candidate self-practice to a
> company platform. Workspaces, team invites, candidate records, scheduling, candidate links (no account needed),
> interviewer-only scorecards, a Claude-generated AI assessment, coding and behavioural rounds, custom problems and
> rubrics, multi-round loops, configurable email and Google Calendar / .ics invites are built and tested against
> Postgres. Not yet run against a live Supabase project, Google or a mail provider. See
> [`docs/company-platform/PROGRESS.md`](docs/company-platform/PROGRESS.md).

---

## Contents

- [Quick start](#quick-start)
- [Set up Supabase](#set-up-supabase)
- [Turn on the AI assessment](#turn-on-the-ai-assessment)
- [Turn on email and calendar invites](#turn-on-email-and-calendar-invites)
- [Deploy to Vercel](#deploy-to-vercel)
- [How it works](#how-it-works)
- [Project structure](#project-structure)
- [Decision log](#decision-log)
- [Edge cases handled](#edge-cases-handled)
- [Known limitations](#known-limitations)
- [Testing](#testing)
- [Working on this codebase](#working-on-this-codebase)
- [Documentation](#documentation)

---

## Quick start

Requires Node 20.9+ (developed on Node 22).

```bash
npm install
cp .env.example .env.local   # then fill in the Supabase values (next section)
npm run dev                  # http://localhost:3000
```

Without Supabase values the site still runs. The landing page renders, and `/login` shows a "Sign-in isn't connected
yet" notice instead of failing.

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` / `npm start` | Production build / serve it |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript (`tsc --noEmit`) |
| `npm test` | Unit tests plus database tests (an in-process Postgres, no Docker needed) |

## Set up Supabase

1. **Create a project** at [supabase.com](https://supabase.com).
2. **Run the migrations**, in filename order. Either paste each file in `supabase/migrations/` into the SQL editor,
   or with the Supabase CLI: `supabase link --project-ref <ref>` then `supabase db push`.
   > `20261031000000_company_platform.sql` **drops** the earlier candidate profiles, waitlist and practice sessions.
   > Back up anything you want to keep before applying it to an existing project.
   > `20261101000000_rounds_rubrics_loops_calendar.sql` is additive: existing interviews become system design rounds.
3. **Copy the keys** from *Project Settings → API* into `.env.local`: the URL and the **publishable** key. The
   **secret** key is only needed for the AI assessment (next section) and must never get a `NEXT_PUBLIC_` prefix.
4. **Auth → Sign In / Providers → Anonymous sign-ins: on.** Candidates join from their link without an account
   (ADR 0008). Supabase recommends turning on CAPTCHA or tightening rate limits for anonymous sign-ins in production.
5. **Auth → URL configuration**
   - Site URL: your production URL (e.g. `https://probewise.vercel.app`)
   - Redirect URLs: `http://localhost:3000/**` and `https://<your-domain>/**` (add Vercel preview URLs if you use
     them, e.g. `https://*-probe-wise.vercel.app/**`)
6. **Auth → Email templates → Magic link**: replace the link so it works across devices and includes the typed code:

   ```html
   <h2>Sign in to Probewise</h2>
   <p><a href="{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=email">Sign in</a></p>
   <p>Or enter this code: <strong>{{ .Token }}</strong></p>
   ```

   > Why: `{{ .RedirectTo }}` is the app's own `/auth/confirm?next=…` URL (set when the email is requested), so the
   > link keeps the page the user was heading to (for example a team invite). Supabase's default template uses a PKCE
   > `?code=` link that only works in the browser that requested it; `token_hash` works on any device.
7. **Email delivery**: Supabase's built-in sender is rate-limited to a few emails an hour. Configure custom SMTP
   (Resend, Postmark, SES) under *Auth → SMTP* before inviting a real team.
8. **OAuth (optional)**: enable Google and/or GitHub under *Auth → Providers*, with callback
   `https://<project-ref>.supabase.co/auth/v1/callback`. Then list them in `NEXT_PUBLIC_AUTH_PROVIDERS`.
   Team invites are bound to an email address, so the OAuth account's email must match the invited one.
9. **Realtime (interview rooms)**: under *Project Settings → Realtime*, turn **off** "Allow public access", so every
   channel must pass the RLS policies on `realtime.messages`.

## Turn on the AI assessment

Optional. Without it, the review page says the feature isn't set up.

```bash
ANTHROPIC_API_KEY=sk-ant-...      # Claude API key
SUPABASE_SECRET_KEY=sb_secret_... # Project Settings → API → secret key (or the legacy service_role key)
```

Both are server-only. The secret key is used for one thing: writing the assessment, which clients can't do
themselves, so nobody can pass off their own scores as the AI's (ADR 0009). Generation runs inside a Server
Action and usually takes under a minute; on hosts with short function timeouts, allow at least 120 s.

## Turn on email and calendar invites

Both optional, both server-only. See `.env.example` for every variable.

**Email** (team invites, candidate links, `.ics` invites). Pick one:

```bash
EMAIL_PROVIDER=resend
RESEND_API_KEY=re_...
EMAIL_FROM="Acme Hiring <hiring@acme.com>"   # a domain you've verified with the provider
# or
EMAIL_PROVIDER=smtp
SMTP_HOST=smtp.postmarkapp.com
SMTP_PORT=587
SMTP_USER=...
SMTP_PASS=...
EMAIL_FROM="Acme Hiring <hiring@acme.com>"
```

**Google Calendar** (the default for new workspaces; falls back to `.ics` without it):

1. Google Cloud console → *APIs & Services* → enable the **Google Calendar API**.
2. *OAuth consent screen*: add the scope `.../auth/calendar.events`. Until Google verifies the app, add your team as
   test users.
3. *Credentials → OAuth client ID (Web)*, redirect URI `https://<your-domain>/calendar/google/callback` (and
   `http://localhost:3000/calendar/google/callback` for development).
4. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `CALENDAR_TOKEN_KEY` (`openssl rand -base64 32`; encrypts
   stored refresh tokens). `SUPABASE_SECRET_KEY` is also required (tokens are server-only).
5. Each person who schedules interviews connects their calendar under **Account**. Admins pick Google, `.ics` or
   off under **Team → Calendar invites**.

## Deploy to Vercel

1. Import the repo in Vercel (framework preset: Next.js).
2. Add the env vars from `.env.example`. Set `NEXT_PUBLIC_SITE_URL` to the production URL; candidate links and team
   invites are built from it.
3. Deploy, then add the production URL to Supabase's redirect URLs (step 5 above).

## How it works

```
 company member signs up ──► /onboarding: creates the workspace (admin) ──► invites teammates (email-bound links)
        │
        ▼
 adds a candidate (name, email, role, level) ──► schedules a round, or a loop of several:
        │      type (system design | coding | behavioural) + problem + rubric + 1–2 interviewers + time
        │      ──► calendar invites (Google event with Meet link, or .ics by email)
        ▼
 interviewer opens the room, consents ──► creates the candidate link ──► sends it
        │                                                                     │
        │                     candidate opens /join/<token>, no account ◄─────┘
        │                     (anonymous session, consent) → lobby
        ▼
 interviewer starts ──► shared whiteboard | code editor | conversation, notes, chat, probes, phase timer;
                         every action → hash-chained log
        │
        ▼
 ends ──► each interviewer writes a scorecard on the round's rubric (1–4 per aspect with evidence, recommendation)
        ──► optional AI assessment from the recording ──► side-by-side comparison; loop summary across rounds
        └─► candidate sees "thanks, the team will follow up", never the scores
```

- **The company owns everything.** Candidates are records in the workspace, not accounts. Admins delete them (and
  their interviews) on request.
- **Candidates only get the room.** Their anonymous session can't open any other page, and the database never
  returns them candidate records, scorecards, the AI assessment, private notes or the interviewer guide.
- **Scorecards follow calibration practice**: drafts are private, submission is final, and an interviewer sees
  colleagues' scorecards and the AI's only after submitting their own.
- **Three round types** (ADR 0010): system design on a shared whiteboard, coding in a shared editor (the candidate
  types, interviewers watch; code isn't run), behavioural as a guided conversation.
- **Your own problems and rubrics** (ADR 0011): every interview keeps a copy of the rubric it was scheduled with, so
  editing a rubric never changes past scores.
- **Loops** (ADR 0012) roll several rounds into one summary, with the same release rules as single scorecards.
- **Everything is recorded** as a hash-chained event, so editing or deleting history is detectable. The review page
  shows "Record verified".
- **The database is the authority.** Every write goes through a function that checks the caller's workspace, role
  and the session state.

Full design: [`docs/architecture/interview-sessions.md`](docs/architecture/interview-sessions.md).

## Project structure

```
src/
  app/
    page.tsx                 Landing page
    login/                   Email link + one-time code + OAuth (hiring team only)
    auth/callback|confirm    OAuth and magic-link return URLs
    onboarding/              Create your company's workspace
    dashboard/               Your interviews, scorecards to write, the team's schedule
    candidates/              List, add, [id]: details, loops, interviews, schedule (rounds or loops), delete
    loops/[id]/              Loop summary across rounds
    rubrics/                 Built-in and custom rubrics, defaults per round type
    calendar/google/         OAuth connect + callback routes
    interview/               All interviews; [id] room (or join gate), [id]/review, [id]/export (JSON), [id]/invite.ics
    join/[token]/            The candidate's way in (public)
    team/                    Members, roles, invites, workspace name; join/[token] accepts an invite
    problems/                Built-in and custom problems; new, custom/[id] (edit, archive)
    account/                 Your name, delete account
    actions/                 Server Actions (auth, org, candidates, interview)
  components/
    interview/               Room, whiteboard (Excalidraw), chat, phase bar, guide, scorecard, links, AI panel
    candidates/, workspace/  Forms for candidates, scheduling, team, calendar settings
    library/                 Problem form, rubric editor
  lib/
    dal.ts                   Data access layer: viewer, workspace membership, guards
    interview/               rounds.ts (round types), phases, rubric, events, metrics, board merge + text, tokens,
                             session DAL, ai-assessment.ts (Claude call, prompt, output schema)
    problems/                Built-in banks (server-only: include guides), catalog, custom problem source
    email/                   Provider interface (Resend, SMTP) and templates
    calendar/                Google Calendar client, .ics builder, invite orchestration
    secret-box.ts            AES-256-GCM for stored OAuth tokens
    membership.ts            Post-login routing, request origin
    routes.ts                Which paths are protected, candidate-only, workspace-free
    org.ts                   Workspace roles
    supabase/                Server, browser and service (secret-key) clients
  proxy.ts                   Session refresh + coarse route guarding (Next 16's name for middleware)
supabase/
  migrations/                Schema, RLS, functions (foundation, sessions, company platform)
  tests/                     Database tests run against PGlite (in-process Postgres)
docs/
  company-platform/          Plan and progress for this change
  milestone-2/               The interview room's plan and log
  adr/                       Architecture decision records
  architecture/              System design docs
```

## Decision log

Milestone 1 decisions, with the reasoning. From milestone 2 onwards, decisions are ADRs in
[`docs/adr/`](docs/adr/). ADR 0007 replaced the candidate-practice model (rows 2–7, 10, 12 below).

| # | Decision | Why | Alternatives considered |
| --- | --- | --- | --- |
| 1 | **Next.js 16 (App Router) on Vercel, Supabase for auth and Postgres** | Auth, database and row-level security in one service. Server routes give a safe place to call Claude without exposing keys. | Static hosting + client-only Supabase (no safe place for LLM calls); a custom backend (more work before users see anything). |
| 2 | ~~Audience: candidates practising only~~ → **hiring teams** (ADR 0007) | Companies run the interview and own the record. | Two-sided marketplace. |
| 3–7 | ~~100-seat cap, FIFO waitlist, `claim_seat()`, `app_config`~~ → removed (ADR 0007) | Access is per workspace now. | — |
| 8 | **Passwordless: magic link + 6-digit code, plus optional Google/GitHub** | No passwords to store, reset or leak. The code is a fallback when the link opens in another browser or an email scanner pre-clicks it. | Email + password. |
| 9 | **OAuth buttons only for providers listed in `NEXT_PUBLIC_AUTH_PROVIDERS`** | A half-configured provider would strand people on an error page. | Always show both. |
| 10 | ~~Candidate profile drives problem selection~~ → **candidate record with role and level** (ADR 0007) | The company knows what it's hiring for. | — |
| 11 | **Option lists in TypeScript, duplicated in SQL `CHECK`s, with a test that fails if they drift** | The database stays the final guard, and the UI has one source for labels. | Postgres enums; lookup tables. |
| 12 | **Deleting is self-serve and cascades**: accounts, and (for admins) candidates with their interviews | Honest about personal data; candidates can ask to be removed. | Soft delete. |
| 13 | **Proxy only does coarse redirects; pages re-check in the data access layer** | The real authorisation check sits next to the data. Server Actions re-authorise too. | Middleware-only guarding. |
| 14 | **Cache Components enabled; session reads sit inside `<Suspense>`** | The static shell loads instantly; personalised parts stream in. | Fully dynamic pages. |
| 15 | **Fonts vendored locally** | Builds never depend on a font CDN. | `next/font/google`. |
| 16 | **Visual identity: "whiteboard"**, marker blue for actions, red pen for probing questions and errors | It's the product's own world. | Generic SaaS look. |

## Edge cases handled

**Workspaces and team** (`supabase/tests/interview-sessions.test.ts`)
- Signing up twice, or creating a second workspace: refused; one workspace per account.
- Team invites only work for the invited address (case-insensitive), once, for 7 days; a second account with the
  same address can't reuse an accepted invite. A new invite for the same address cancels the pending one.
- Only admins invite, change roles, remove people and delete candidates. The last admin can't be demoted, and can't
  delete their account while others remain. The last person deleting their account removes the workspace.
- Invite token hashes aren't readable by clients, even admins.

**Candidates and scheduling**
- Another workspace's candidates can't be read, edited, scheduled or moved between workspaces (RLS + column grants).
- Duplicate emails within a workspace are rejected with a plain message.
- Scheduling checks the candidate and every interviewer belong to the workspace, 1–2 interviewers, at most 3 open
  interviews per candidate, and a date within a year.

**Candidate links**
- Expired, replaced, revoked, already-used and malformed links each get their own message. A link stops working
  when the interview ends.
- A candidate opening their link twice goes straight back to the room. Switching device: a new link moves them over,
  and the old browser loses access.
- Someone from the company opening the candidate's link is told to send it on (or use a private window), instead of
  becoming the candidate in their own record.
- The interview can't start until the candidate is in.

**Interview room** (unchanged from milestone 2)
- Concurrent drawing merges by element version, the same way in the browser and in SQL.
- Dropped realtime messages, reconnects, sleeping laptops and background tabs catch up from the log.
- Pending board and notes saves are flushed before the interview ends.
- Tampering (edited payloads, updates even by the owner, truncation, deleted tail events) is detected or blocked.

**Rounds, library and loops** (`supabase/tests/rounds-library-calendar.test.ts`)
- Phases, board events and code events are only accepted for the right round type; starter code lands in the editor.
- Only the candidate edits code; unchanged code isn't recorded twice; unknown languages and oversized code are refused.
- Scorecards and the AI assessment are validated against the session's own rubric snapshot; older sessions fall
  back to the built-in rubric.
- Custom problems: workspace-only (candidates can't read the guide), never deleted, version bumps on edit, round
  type fixed, archived ones can't be scheduled. Rubrics: admins only, one default per round, shape validated.
- Loops must belong to the same workspace and candidate as their rounds.
- Accented aspect names get clean keys (`Énergie` → `energie`).

**Email and calendar**
- OAuth: random state in an httpOnly cookie, bound to the user, compared in constant time; missing calendar scope
  reported plainly; refresh tokens encrypted, never readable by clients, revoked on disconnect.
- Google unavailable or not connected → `.ics` by email → nothing, with a note saying which happened. Failures never
  undo scheduling. Cancelling withdraws the event or sends an `.ics` cancellation with the same UID.
- `.ics` output is RFC 5545: CRLF, folded lines, escaped text, UTC times (tested).

**Scorecards and the AI assessment**
- Only interviewers write scorecards; drafts during the interview, submit after; immutable after submission.
- Release without anchoring: a participating interviewer sees nothing of others' scores or the AI's until they
  submit. The candidate never sees either.
- AI: only the server can write it, only after the interview, only on a team member's request; one per interview;
  failed or stuck runs can be retried; refusals, truncation, rate limits and bad keys get specific messages; the
  output is validated against the schema and clipped to database limits.

**Sign-in**
- Magic links across devices, expired links, wrong codes, rate limits and OAuth errors each map to a plain message.
- `?next=` is protected against open redirects (tested). Redirect URLs use `NEXT_PUBLIC_SITE_URL` in production.
- A candidate's anonymous session visiting `/login` sees the sign-in form, and any other protected page sends them
  there.

## Known limitations

- **Not yet tested end to end against a live Supabase project.** The SQL (functions, RLS, realtime topic rules) is
  tested on PGlite with stubs of `auth` and `realtime`; the app builds, type-checks and lints. First thing to do:
  a full interview in two browsers (one private window for the candidate).
- **Email and Google Calendar are untested against real providers.** The code follows their documented APIs; the
  `.ics` output and token encryption are unit-tested.
- **No rescheduling.** Cancel and schedule again. No reminder emails beyond calendar reminders.
- **Code isn't executed** in coding rounds, and only the candidate types (no pair-editing).
- **One workspace per account.**
- **No in-app audio/video** (future scope). Google Calendar events include a Meet link, shown in the room, but calls
  aren't recorded, so the AI assessment can't hear what was said.
- **Seq gaps reveal timing.** Interviewer-only events share the session's sequence, so the candidate's client can
  tell *that* (not *what*) an interviewer saved private notes.
- **Problem snapshots are supplied to `create_session` by the server action**; a member calling the RPC directly
  could make one up for their own workspace. Fix: a `problem_catalog` table (ADR 0004).
- **Database types are hand-written** in `src/lib/database.types.ts`. Regenerate once a project exists.
- **Excalidraw fonts load from its CDN** by default.
- No timeline replay scrubber yet; the log supports it.

## Testing

```bash
npm test
```

- `src/lib/__tests__/`: route rules (protected, candidate-only, workspace-free), open-redirect protection, error
  mapping, env parsing, text cleanup, vocabularies matching the SQL (phases, aspects, event types, recommendations,
  roles, levels), the problem bank, board merging and board-to-text, invite tokens, scorecard validation, session
  metrics, and the AI assessment's prompt and output normalisation.
- `supabase/tests/`: runs every migration on PGlite with a small stub of Supabase's `auth` (including anonymous
  users) and `realtime` schemas, then tests as `anon`, `authenticated` and `service_role`: workspaces and invites,
  candidates, scheduling, joining, candidate links, the lifecycle and permission matrix, RLS isolation between
  workspaces and from candidates, realtime topics, the hash chain, scorecard release rules, the AI assessment's
  write path and release, and account deletion.

## Working on this codebase

- **This is Next.js 16.** `middleware.ts` is now `src/proxy.ts`. Docs ship in `node_modules/next/dist/docs/`;
  `AGENTS.md` points coding agents there.
- **Cache Components is on.** Anything that reads cookies, headers or `searchParams` must render inside a
  `<Suspense>` boundary. The pattern: the page renders static headings, and an async child inside `<Suspense>`
  calls `requireMember()` / `requireViewer()` from `src/lib/dal.ts`.
- **Schema changes** go in a new file in `supabase/migrations/`. Never edit an applied migration. Vocabulary tests
  read the latest definition across all migrations.
- **Copy** is sentence case, plain verbs, buttons say what they do, and errors say what happened and how to fix it.

## Documentation

| Doc | What's in it |
| --- | --- |
| [`USAGE_GUIDE.md`](USAGE_GUIDE.md) | Setup, running interviews as a team, the candidate's experience, scoring, admin tasks, troubleshooting |
| [`docs/company-platform/PROGRESS.md`](docs/company-platform/PROGRESS.md) | What changed in the move to a company platform, status, next steps |
| [`docs/architecture/interview-sessions.md`](docs/architecture/interview-sessions.md) | Data model, lifecycle, permission matrix, audit log, realtime, limits |
| [`docs/adr/`](docs/adr/) | Architecture decision records |
| [`docs/milestone-2/`](docs/milestone-2/) | The interview room's original plan and log |
