# Probewise

Practice system design interviews with an interviewer that follows up the way a real one does, tailored to the
role, level and domain you're interviewing for.

**Phase 1** is system design interviews for the first 100 candidates. Code review and bug-fixing rounds come later.

> **Status of this branch (`feature/phase1-m2-interview-room`)**: milestones 1 and 2 are built. Milestone 1 covers
> accounts, the 100-seat cap with a waitlist, onboarding and profile. Milestone 2 adds the problem bank and a
> **shared, fully recorded interview room** for a candidate and up to two human interviewers, with scorecards and a
> review page. The AI interviewer is milestone 3. See [Roadmap](#roadmap) and
> [`docs/milestone-2/PROGRESS.md`](docs/milestone-2/PROGRESS.md).

---

## Contents

- [Quick start](#quick-start)
- [Set up Supabase](#set-up-supabase)
- [Deploy to Vercel](#deploy-to-vercel)
- [How sign-up and the 100-seat cap work](#how-sign-up-and-the-100-seat-cap-work)
- [How interview sessions work](#how-interview-sessions-work)
- [Project structure](#project-structure)
- [Decision log](#decision-log)
- [Edge cases handled](#edge-cases-handled)
- [Known limitations](#known-limitations)
- [Testing](#testing)
- [Working on this codebase](#working-on-this-codebase)
- [Roadmap](#roadmap)
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

1. **Create a project** at [supabase.com](https://supabase.com) (the free tier is enough for 100 users).
2. **Run the migrations**, in filename order. Either paste each file in `supabase/migrations/` into the SQL editor,
   or with the Supabase CLI: `supabase link --project-ref <ref>` then `supabase db push`.
3. **Copy the keys** from *Project Settings → API* into `.env.local`: the URL and the **publishable** key. Never put
   the secret or service-role key in this app; nothing here needs it.
4. **Auth → URL configuration**
   - Site URL: your production URL (e.g. `https://probewise.vercel.app`)
   - Redirect URLs: `http://localhost:3000/**` and `https://<your-domain>/**` (add Vercel preview URLs if you use
     them, e.g. `https://*-probe-wise.vercel.app/**`)
5. **Auth → Email templates → Magic link**: replace the link so it works across devices and includes the typed code:

   ```html
   <h2>Sign in to Probewise</h2>
   <p><a href="{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=email">Sign in</a></p>
   <p>Or enter this code: <strong>{{ .Token }}</strong></p>
   ```

   > Why: `{{ .RedirectTo }}` is the app's own `/auth/confirm?next=…` URL (set when the email is requested), so the
   > link keeps the page the user was heading to. Supabase's default template instead uses a PKCE `?code=` link that
   > only works in the browser that requested it; `token_hash` works on any device. `/auth/confirm` handles both, so
   > the default template still works if you skip this step, just less reliably.

6. **Email delivery**: Supabase's built-in email sender is rate-limited to a few emails an hour, which is fine for
   testing but not for 100 real users. Configure custom SMTP (Resend, Postmark, SES) under *Auth → SMTP* before
   launch.
7. **OAuth (optional)**: enable Google and/or GitHub under *Auth → Providers*, with callback
   `https://<project-ref>.supabase.co/auth/v1/callback`. Then list them in `NEXT_PUBLIC_AUTH_PROVIDERS`. Buttons only
   appear for providers listed there, so a half-configured provider never sends people to an error page.
8. **Realtime (interview rooms)**: under *Project Settings → Realtime*, turn **off** "Allow public access", so every
   channel must pass the RLS policies on `realtime.messages`. The room uses private channels
   (`session:<id>`, `session:<id>:interviewers`); the policies come with the milestone 2 migration.
9. **Change the cap** at any time, without a deploy:
   `update public.app_config set seat_cap = 150;`

## Deploy to Vercel

1. Import the repo in Vercel (framework preset: Next.js).
2. Add the env vars from `.env.example`. Set `NEXT_PUBLIC_SITE_URL` to the production URL.
3. Deploy, then add the production URL to Supabase's redirect URLs (step 4 above).

GitHub Pages can't run this app (it needs a server for auth). The old static `index.html` was removed. Turn off
GitHub Pages for the repo once Vercel is live, or point the custom domain at Vercel.

## How sign-up and the 100-seat cap work

```
Visitor ──sign in (magic link / code / Google / GitHub)──► authenticated
                                                             │
                                          app calls claim_seat() in Postgres
                                                             │
                       ┌──────────── seat free and nobody waiting ahead? ────────────┐
                       ▼ yes                                                          ▼ no
              profile row created (= seat)                                  added to waitlist (FIFO)
                       │                                                              │
              onboarding not done? ──► /onboarding                      /waitlist shows position
                       │                                                              │
                       ▼                                          seat frees up (member deletes account,
                  /dashboard                                       or cap raised) → next in line gets it
                                                                   on their next sign-in / "Check for a seat"
```

- **A seat is a row in `profiles`.** Only `claim_seat()` (a `security definer` function) can create one. Clients
  can't insert profiles directly.
- `claim_seat()` takes a Postgres advisory lock, so two people signing up in the same millisecond can't both take
  seat 100.
- Signing in alone doesn't consume a seat. The seat is claimed after the email or OAuth step succeeds, so abandoned
  or unverified sign-ups can't squat seats.
- `claim_seat()` runs on **every** sign-in. It's idempotent for members and is how waitlisted users get promoted.

## How interview sessions work

```
member picks a problem ──► create_session (solo | peer, consent) ──► lobby
                                                                       │ peer: candidate shares a one-time invite link;
                                                                       │       interviewer signs in (no seat needed), consents, joins
                                                                       ▼
                            controller starts ──► in_progress: shared board, notes, chat, probes, phase timer
                                                                       │ every action → record_event() → append-only,
                                                                       │ hash-chained session_events → broadcast to the room
                                                                       ▼
                                                   end ──► review: integrity check, time per phase, transcript,
                                                           final board, scorecards (immutable once submitted), JSON export
```

- **Everything is recorded** as an event: board deltas, notes, chat, interviewer questions, phase changes, joins,
  consent and evaluations. Each event is chained to the previous one by SHA-256, so editing or deleting history is
  detectable. The review page shows "Record verified".
- **The database is the authority.** Clients can only read. Every write goes through one function that checks role
  and session state, and the same transaction broadcasts the event, so what you see live is what was recorded.
- **Interviewers get a private guide** (hidden requirements, numbers, probes, rubric signals) and private notes,
  neither of which ever reaches the candidate's browser.
- **Scorecards** follow interview-calibration practice: drafts are private, submission is final, and interviewers
  see other evaluations only after submitting their own.

Full design: [`docs/architecture/interview-sessions.md`](docs/architecture/interview-sessions.md).

## Project structure

```
src/
  app/
    page.tsx                 Landing page (static, seat counter streams in)
    login/                   Email link + one-time code + OAuth
    auth/callback/route.ts   OAuth return URL
    auth/confirm/route.ts    Magic-link return URL
    onboarding/              First-run profile setup
    dashboard/               Home for members
    problems/                Problem bank: list + detail/start
    interview/               Your sessions; [id] room, [id]/review, [id]/export (JSON); join/[token]
    profile/                 Edit profile, delete account
    waitlist/                Position in line, leave waitlist
    actions/                 Server Actions (auth, profile, interview)
    error.tsx, not-found.tsx
  components/                UI (site chrome, profile form, hero sketch…)
    interview/               Room, whiteboard (Excalidraw), chat, phase bar, guide, evaluation form, realtime hook
  lib/
    dal.ts                   Data access layer: every auth/membership check goes through here
    interview/               Phases, events, rubric, metrics, board merge, invite tokens, session DAL
    problems/                Problem bank (server-only: includes interviewer guides) + ranking
    membership.ts            claim_seat + post-login routing
    profile-options.ts       Roles, levels, domains, focus areas (single source of truth)
    profile-schema.ts        Server-side validation of the profile form
    safe-redirect.ts         Open-redirect protection for ?next=
    supabase/                Server and browser Supabase clients
  proxy.ts                   Session refresh + coarse route guarding (Next 16's name for middleware)
supabase/
  migrations/                Schema, RLS, functions (milestone 1 foundation, milestone 2 sessions)
  tests/                     Database tests run against PGlite (in-process Postgres)
docs/
  milestone-2/               Plan and live progress tracker
  adr/                       Architecture decision records (milestone 2 onwards)
  architecture/              System design docs
```

## Decision log

Decisions made for milestone 1, with the reasoning, so they can be revisited deliberately rather than by accident.
From milestone 2 onwards, decisions are recorded as ADRs in [`docs/adr/`](docs/adr/) (event log, realtime,
whiteboard, problem bank, participants, evaluation rules).

| # | Decision | Why | Alternatives considered |
| --- | --- | --- | --- |
| 1 | **Next.js 16 (App Router) on Vercel, Supabase for auth and Postgres** | Auth, database and row-level security in one free-tier service. Server routes give us somewhere safe to call LLMs in milestone 3 without exposing API keys. | Static GitHub Pages + client-only Supabase (no safe place for LLM calls); custom FastAPI on AWS (more work before users see anything). |
| 2 | **Audience: candidates practising only** | Phase 1 validates the practice experience. The old landing copy targeted hiring teams and was rewritten. | Two-sided (candidates + companies): doubles the surface area before we know the core loop works. |
| 3 | **Open sign-up capped at 100, overflow goes to a FIFO waitlist** | No manual invite step, but cost (LLM spend) and support load stay bounded. A waitlist instead of "sorry, full" keeps demand visible. | Invite-only with approval: more control, more admin work. |
| 4 | **Seat = profile row, created only by `claim_seat()` in Postgres** | The cap is enforced where it can't be bypassed (not in app code), and is race-safe with an advisory lock. | App-level counting: racy; DB trigger on `auth.users`: would count unverified sign-ups. |
| 5 | **Seat claimed after verified sign-in, not at account creation** | Bots and typo'd emails never consume a seat. | Claim on `auth.users` insert. |
| 6 | **Freed seats go to the waitlist first, in join order** | Fair. A newcomer can't jump the queue just by signing in at the right moment. | First come at the moment a seat frees: rewards refreshing, not waiting. |
| 7 | **Cap stored in `app_config`, not code** | Raise it to 150 with one SQL statement, no deploy. | Env var: needs a redeploy and can disagree between instances. |
| 8 | **Passwordless: magic link + 6-digit code, plus optional Google/GitHub** | No passwords to store, reset or leak. The code is a fallback when the link opens in another browser or an email scanner pre-clicks it. | Email + password: more flows (reset, strength rules) for no gain at this stage. |
| 9 | **OAuth buttons only for providers listed in `NEXT_PUBLIC_AUTH_PROVIDERS`** | A provider that's half set up in Supabase would otherwise strand people on an error page. | Always show both. |
| 10 | **Profile captures role, level, up to 3 domains, focus areas, target companies, interview date** | These drive problem selection and interviewer difficulty in milestones 2–3. Domains capped at 3 so recommendations stay focused. | Free-text "what are you preparing for": unstructured, can't drive matching. |
| 11 | **Option lists live in `profile-options.ts`, duplicated in SQL `CHECK`s, with a test that fails if they drift** | The database stays the final guard against tampered forms, and the UI has one source for labels. | Postgres enums (harder to change); lookup tables (overkill for now). |
| 12 | **Delete account is self-serve and cascades** | Frees the seat immediately and keeps us honest about user data from day one. | Soft delete: keeps data we don't need. |
| 13 | **Proxy (middleware) only does coarse redirects; pages re-check in the data access layer** | Middleware checks are a convenience; Next's own guidance is that the real authorisation check sits next to the data. Server Actions re-authorise too. | Middleware-only guarding. |
| 14 | **Cache Components enabled; session reads sit inside `<Suspense>`** | The static shell (header, headings) loads instantly; personalised parts stream in. Next 16 makes un-suspended cookie reads a build error. | Fully dynamic pages: slower first paint. |
| 15 | **Fonts vendored locally** (IBM Plex Sans, Caveat for hand-written annotations) | Builds never depend on a font CDN; no layout shift from late font loads. | `next/font/google`: fails builds in restricted networks. |
| 16 | **Visual identity: "whiteboard"**, with marker blue for actions and red pen reserved for the interviewer's probing questions and errors | It's the product's own world: a design on a whiteboard being questioned. | Generic SaaS look. |

## Edge cases handled

**Seat cap and waitlist** (all covered by `supabase/tests/seat-cap.test.ts`)
- Concurrent sign-ups racing for the last seat: serialised by an advisory lock, never more than the cap.
- The same user signing in in two tabs at once: idempotent, one seat.
- A seat frees up while people are waiting: goes to the head of the queue, not a newcomer.
- Cap raised: waitlisted users are admitted in order. Cap lowered below current members: existing members keep
  seats, new people are waitlisted.
- A waitlisted user can leave (deletes their account) and see their position and queue length.
- A member opening `/waitlist`, or a waitlisted user opening `/dashboard`: each is redirected to where they belong.
- The `claim_seat` call failing (network, DB down): the user lands on `/waitlist` with a clear "try again" message
  and a **Check for a seat** button, not a dead end.

**Sign-in**
- Magic link opened in a different browser or device: works with the `token_hash` template. If the PKCE link is
  used instead, the error explains it and offers the code.
- Expired or already-used links, wrong codes, rate limits, OAuth cancelled, provider disabled: each maps to a
  specific, plain message. Raw provider or database errors are never shown.
- Resend has a 60-second cooldown in the UI (Supabase rate-limits server-side too).
- "Use a different email" goes back without losing the form.
- Email is trimmed, lowercased and length-checked. The one-time code accepts spaces and dashes.
- `?next=` is protected against open redirects: `//evil.com`, `/\evil.com`, encoded and double-encoded variants,
  control characters, absolute URLs, and loops back into `/login` or `/auth/*` (tested).
- Redirect URLs for emails use `NEXT_PUBLIC_SITE_URL` in production, so a spoofed `Host` header can't redirect
  magic links elsewhere.
- Signed-in users visiting `/login` skip to where they were going. Signed-out users hitting protected pages return
  to them after signing in.
- Supabase not configured, or auth service unreachable: pages render, and protected pages treat the visitor as
  signed out instead of returning a 500.

**Profile and onboarding**
- Validation runs on the server (zod) **and** in the database (`CHECK` constraints). Tampered form values are
  rejected even if the UI is bypassed.
- Every field error is shown at once, focus moves to the first one, and the typed input is kept (React resets
  uncontrolled forms after an action, so the form is controlled).
- Names: unicode-normalised, zero-width and control characters stripped, whitespace-only rejected.
- Domains: max 3. Further choices are disabled in the UI and rejected on the server. Duplicates are de-duplicated.
- Companies: comma, semicolon or newline separated, de-duplicated case-insensitively, max 5, 60 characters each.
- Interview date: must be a real calendar date, upcoming (with a day of slack for time zones) and within a year.
  A stored date that has since passed can be re-saved unchanged.
- Onboarding can't be marked complete without the required fields (DB constraint).
- Visiting `/onboarding` after finishing it goes to the dashboard. Unfinished members are sent to onboarding from
  every member page.
- Unsaved changes on the profile page: browser warning before leaving, a **Discard changes** button, and Save stays
  disabled until something changes.
- Double submits: every submit button disables itself while its action runs.

**Account**
- Delete account requires typing DELETE, removes the auth user, cascades to profile and waitlist, and frees the
  seat.
- Changing the auth email keeps the profile and waitlist email in sync (trigger).

**Security**
- Row-level security: users read and update only their own profile, and only the editable columns. `id`, `email`
  and seat columns are read-only. No client can insert or delete profiles, or touch `app_config` or other people's
  waitlist rows.
- All `security definer` functions pin `search_path` and have execute revoked from `anon` except the public seat
  counter.
- Server Actions re-check the session themselves instead of trusting the page.

**Accessibility and UI**
- Keyboard focus is always visible, there's a skip-to-content link, and errors are announced with `role="alert"`
  and linked to fields with `aria-describedby`.
- Light and dark mode. The hero animation is disabled under `prefers-reduced-motion`.
- Responsive layouts, checked at phone width (390px) and desktop.

**Interview sessions** (covered by `supabase/tests/interview-sessions.test.ts` and the unit tests)
- Two people drawing the same shape at once: merged by element version, ties broken deterministically, the same
  way in the browser and in SQL. Stale or echoed deltas are ignored and not recorded twice.
- Dropped realtime messages, reconnects, a sleeping laptop or a backgrounded tab: the client sees a gap in the
  sequence numbers, or gets a reconnect or visibility event, and reads what it missed from the log.
- Refreshing mid-interview: the page loads a consistent snapshot (board, notes, phase, events up to `last_seq`)
  and catches up from there. Unsaved notes trigger a "leave page?" warning.
- Ending the interview with strokes or notes still unsaved: pending saves are flushed before the session closes.
- Invites: self-invites, reused, expired, revoked and malformed links are each rejected with a clear message; a
  third interviewer is refused; making a new link cancels the old one; clicking your own accepted link again just
  takes you to the room.
- An invited interviewer signing in never takes one of the 100 seats and is never sent to the waitlist.
- Interviewers' private notes and guide: never in the candidate's page, API responses, realtime messages or export.
- Tampering: an edited payload, an `UPDATE` (even by the table owner), truncation and events deleted from the end
  are all detected or blocked.
- Account deletion: a candidate's sessions are removed; an interviewer is anonymised and the log still verifies.
- Non-participants get a 404 for rooms, reviews and exports, so whether a session exists isn't revealed.

## Known limitations

- **Waitlist promotion is lazy.** When a seat frees, the next person in line gets it the next time they sign in
  or press "Check for a seat". There's no email telling them yet. Fix in milestone 4 with a Supabase database
  webhook or cron plus email.
- **Seat counter is cached for about a minute**, so the landing page can be briefly out of date. The real cap is
  always enforced in the database.
- **No admin UI yet.** Change the cap or inspect the waitlist in the Supabase SQL editor.
- **Database types are hand-written** in `src/lib/database.types.ts`. Regenerate once a project exists:
  `npx supabase gen types typescript --project-id <ref> > src/lib/database.types.ts`.
- **Interview room not yet tested end to end against a live Supabase project.** The SQL (functions, RLS, the
  realtime topic rules) is tested on PGlite with a stub of the `realtime` schema; the UI builds and type-checks.
  First thing to do once a project exists: open a peer session in two browsers.
- **No audio/video.** Sessions record actions, not media. Participants use any call tool alongside the room.
  Recording A/V needs a media provider (LiveKit/Daily) and a separate consent decision.
- **Seq gaps reveal timing.** Private interviewer events share the session's sequence, so a candidate's client can
  tell *that* (not *what*) an interviewer saved private notes. Acceptable for practice; separate sequences would
  fix it.
- **Problem snapshots are client-supplied to `create_session`** (built by the server action, but a member calling
  the RPC directly could make one up). It only affects their own practice. Fix: a `problem_catalog` table (ADR 0004).
- **Live strokes that were never saved**: if someone closes their tab within ~1.5 s of drawing, others may have seen
  a stroke that isn't in the record. Flushes on `pagehide`/hidden tab make this rare.
- **Excalidraw fonts load from its CDN** by default. Self-hosting them (copy to `public/` and set
  `EXCALIDRAW_ASSET_PATH`) is a small follow-up.
- No timeline replay scrubber yet; the log supports it.
- No end-to-end browser tests against a live Supabase project yet. The database logic is tested against real
  Postgres (PGlite), and the pages were checked rendering without Supabase configured.

## Testing

```bash
npm test
```

- `src/lib/__tests__/`: profile validation, open-redirect protection, route rules (including seat-free paths),
  error mapping, env parsing, checks that option lists, phases, event types and recommendations match the SQL, the
  problem bank's structure (and that guides never leak into snapshots or summaries), board merging, invite tokens,
  evaluation validation and session metrics.
- `supabase/tests/`: runs the real migration on PGlite (Postgres compiled to WASM, in-process) with a small stub
  of Supabase's `auth` and `realtime` schemas, then tests seat claiming, the waitlist, RLS, grants, constraints
  and account deletion as the `anon` and `authenticated` roles. `interview-sessions.test.ts` covers the session
  lifecycle, the permission matrix, invites, RLS isolation, private-note leakage, realtime topic rules, the hash
  chain (tamper detection) and evaluation release rules.

## Working on this codebase

- **This is Next.js 16.** Some APIs differ from older tutorials. `middleware.ts` is now `src/proxy.ts`. Error
  boundaries receive `retry` instead of `reset`. Docs ship in `node_modules/next/dist/docs/`; `AGENTS.md` points
  coding agents there.
- **Cache Components is on.** Anything that reads cookies, headers or `searchParams` must render inside a
  `<Suspense>` boundary, or the build fails. The pattern used throughout: the page renders static headings, and an
  async child inside `<Suspense>` calls `requireMember()` / `requireViewer()` from `src/lib/dal.ts`.
- **Adding a profile option** (role, domain…): add it to `src/lib/profile-options.ts` **and** the matching `CHECK`
  in a new migration. `npm test` fails until both match.
- **Schema changes** go in a new file in `supabase/migrations/`. Never edit an applied migration.
- **Copy** is sentence case, plain verbs, buttons say what they do ("Save changes", not "Submit"), and errors say
  what happened and how to fix it.

## Roadmap

- **Milestone 1: foundation** ✅
- **Milestone 2: problem bank and collaborative interview room** ✅ this branch. 30 problems with interviewer guides;
  solo and peer sessions; shared Excalidraw board, notes, chat and probes; phase timer; append-only hash-chained
  audit log; scorecards, self-assessment, review page and JSON export.
- **Milestone 3: AI interviewer.** Phase-aware prompting that follows up on weak spots and the member's chosen
  focus areas, difficulty by level, a per-session token budget and per-user monthly cap, and scoring against a
  rubric.
- **Milestone 4: feedback and operations.** Per-phase scores, interviewer notes, a reference design, progress over
  time, waitlist emails, an admin view (invites, usage, cost per user), session-recording consent, privacy and
  terms pages, and analytics.

## Documentation

| Doc | What's in it |
| --- | --- |
| [`USAGE_GUIDE.md`](USAGE_GUIDE.md) | Setup (hosted or local Supabase), using it as candidate/interviewer, scoring, admin tasks, troubleshooting |
| [`docs/milestone-2/PLAN.md`](docs/milestone-2/PLAN.md) | Milestone 2 scope, assumptions, work breakdown, risks |
| [`docs/milestone-2/PROGRESS.md`](docs/milestone-2/PROGRESS.md) | Status board and dated log |
| [`docs/architecture/interview-sessions.md`](docs/architecture/interview-sessions.md) | Data model, lifecycle, permission matrix, audit log, realtime, limits |
| [`docs/adr/`](docs/adr/) | Architecture decision records |
