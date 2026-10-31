# Probewise usage guide

How to set up Probewise, run it, and use it: as a company's hiring team (admins and interviewers), what the
candidate experiences, and how to run the instance.

For architecture and design decisions see the [README](README.md),
[`docs/architecture/interview-sessions.md`](docs/architecture/interview-sessions.md) and [`docs/adr/`](docs/adr/).

> **Status:** the company platform (workspaces, candidates, scheduling, candidate links, interviewer scorecards,
> AI assessment) is built on `feature/company-platform`. It has been tested at the database level but **not yet end
> to end against a live Supabase project**. Treat your first interview as that test (see
> [Verify your setup](#verify-your-setup)).

## Contents

1. [Prerequisites](#1-prerequisites)
2. [Install and run without a backend](#2-install-and-run-without-a-backend)
3. [Connect Supabase](#3-connect-supabase): [hosted](#option-a-hosted-supabase-project) or [local](#option-b-local-supabase-with-docker)
4. [Environment variables](#4-environment-variables)
5. [Verify your setup](#verify-your-setup)
6. [Deploy to Vercel](#6-deploy-to-vercel)
7. [Setting up your team](#7-setting-up-your-team)
8. [Running an interview](#8-running-an-interview)
9. [Scoring and the AI assessment](#9-scoring-and-the-ai-assessment)
10. [Running the instance (admin tasks)](#10-running-the-instance-admin-tasks)
11. [Development workflow](#11-development-workflow)
12. [Troubleshooting](#12-troubleshooting)

---

## 1. Prerequisites

| Need | Version / notes |
| --- | --- |
| Node.js | 20.9 or newer (developed on 22) |
| npm | Comes with Node |
| A Supabase project | Free tier is enough. Either hosted ([supabase.com](https://supabase.com)) or local via Docker |
| Docker Desktop | Only for a local Supabase stack |
| Two browsers, or a private window | To try an interview (one as the interviewer, one as the candidate) |

## 2. Install and run without a backend

```bash
git clone https://github.com/probe-wise/probe-wise.github.io.git
cd probe-wise.github.io
git switch feature/phase1-m2-interview-room
npm install
cp .env.example .env.local
npm run dev            # http://localhost:3000
```

Without Supabase values the landing page renders, `/login` shows "Sign-in isn't connected yet", and protected pages
redirect to sign-in. This is enough to check the install, but you need Supabase to sign in or run an interview.

## 3. Connect Supabase

Pick **one** of the two options.

### Option A: hosted Supabase project

1. **Create a project** at [supabase.com](https://supabase.com).
2. **Apply the migrations in filename order.** In *SQL Editor*, paste and run each file:
   1. `supabase/migrations/20261030000000_phase1_foundation.sql` (shared helpers)
   2. `supabase/migrations/20261030120000_m2_interview_sessions.sql` (the audit log's hash functions, board merge)
   3. `supabase/migrations/20261031000000_company_platform.sql` (workspaces, candidates, sessions, scorecards, AI
      assessment, RLS, realtime policies). It **drops** the earlier profiles, waitlist and practice sessions.

   Or with the CLI:
   ```bash
   npx supabase login
   npx supabase link --project-ref <your-project-ref>
   npx supabase db push
   ```
3. **Copy the keys** from *Project Settings → API* into `.env.local`: the **Project URL** and the **publishable** key
   (`sb_publishable_…`; older projects call it the anon key). The **secret** key is only for the AI assessment
   ([section 4](#4-environment-variables)) and stays server-side.
4. **Auth → Sign In / Providers → Anonymous sign-ins: on.** Candidates join without an account. For production,
   also turn on CAPTCHA or tighten the anonymous sign-in rate limit.
5. **Auth → URL configuration**
   - Site URL: `http://localhost:3000` for now (your production URL later)
   - Redirect URLs: `http://localhost:3000/**` (plus `https://<your-domain>/**` once deployed)
6. **Auth → Email templates → Magic link**: replace the body so the link works across devices and includes the code:
   ```html
   <h2>Sign in to Probewise</h2>
   <p><a href="{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=email">Sign in</a></p>
   <p>Or enter this code: <strong>{{ .Token }}</strong></p>
   ```
7. **Realtime (required for the interview room)**: in *Project Settings → Realtime*, turn **off** "Allow public
   access". The room uses private channels, which the migration's RLS policies on `realtime.messages` authorise.
8. **Email delivery**: the built-in sender allows only a few emails an hour, which is fine for testing. Before real
   users arrive, configure custom SMTP (Resend, Postmark, SES) under *Auth → SMTP*.
9. **Optional OAuth**: enable Google and/or GitHub under *Auth → Providers*, with callback
   `https://<project-ref>.supabase.co/auth/v1/callback`, then list them in `NEXT_PUBLIC_AUTH_PROVIDERS`.

### Option B: local Supabase with Docker

Useful for development and for testing the interview room without a hosted project.

```bash
# Start Docker Desktop first
npx supabase init            # once: creates supabase/config.toml (keep the existing migrations folder)
npx supabase start           # pulls images on first run (several GB), applies supabase/migrations/*
npx supabase status          # prints the API URL and keys
```

- Put the **API URL** (usually `http://127.0.0.1:54321`) and the **publishable/anon key** from `supabase status`
  into `.env.local`.
- Sign-in emails don't leave your machine. Open the local mail viewer printed by `supabase status` (Mailpit/Inbucket,
  usually `http://127.0.0.1:54324`) to click the magic link or read the code.
- To reset the database and re-run migrations: `npx supabase db reset`.
- Stop the stack: `npx supabase stop`.

## 4. Environment variables

Set these in `.env.local` (locally) or in your host's settings (production). Never commit real values.

| Variable | Required | Example | Purpose |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | yes | `https://abcd.supabase.co` | Supabase API URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | yes | `sb_publishable_…` | Public key. `NEXT_PUBLIC_SUPABASE_ANON_KEY` also works |
| `NEXT_PUBLIC_SITE_URL` | production | `https://probewise.vercel.app` | Canonical URL for sign-in emails, team invites and candidate links. Leave empty locally |
| `NEXT_PUBLIC_AUTH_PROVIDERS` | no | `google,github` | OAuth buttons to show. Empty means email sign-in only |
| `ANTHROPIC_API_KEY` | for AI | `sk-ant-…` | Claude API key for the AI assessment |
| `SUPABASE_SECRET_KEY` | for AI, Google | `sb_secret_…` | Writes AI assessments and stores calendar tokens (clients can't). `SUPABASE_SERVICE_ROLE_KEY` also works. Server-only |
| `EMAIL_PROVIDER` | for email | `resend` or `smtp` | Which mail service sends invites and links. Empty: email off, links are copied |
| `EMAIL_FROM` | for email | `Acme Hiring <hiring@acme.com>` | Sender, on a domain verified with the provider |
| `RESEND_API_KEY` | resend | `re_…` | Resend API key |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE` | smtp | `smtp.postmarkapp.com`, `587` | Any SMTP server. `SMTP_SECURE=true` for port 465 |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | for Google | | OAuth client (Web) with redirect `<site>/calendar/google/callback` and the Calendar API enabled |
| `CALENDAR_TOKEN_KEY` | for Google | `openssl rand -base64 32` | Encrypts stored Google refresh tokens. Changing it disconnects everyone |

Restart `npm run dev` after changing them.

## Verify your setup

Run this checklist once after connecting Supabase. It's also the first live end-to-end test.

1. `npm run dev`, open `http://localhost:3000`, click **Create a workspace** and sign in with your email.
2. On **Create your company's workspace**, enter a company and your name. You land on the dashboard as admin.
3. **Team → Invite a teammate**: invite a second address as interviewer and copy the link. In another browser,
   open it, sign in **with that address**, and join. (Optional, but it tests team invites.)
4. **Candidates → Add candidate** (with your own email so invites reach you), then on their page schedule a round:
   pick a type, problem and yourself, and set a time a few minutes ahead. If email or Google Calendar is set up,
   check the invite arrives (Google needs **Account → Connect Google Calendar** first).
5. You land in the room's join screen: consent and **Enter the room**. In the lobby, **Create candidate link**.
6. Open the link in a **private window** (you're signed in to the workspace in your main window, so the link
   refuses you there, on purpose). Enter a name, consent, and join. No sign-in is asked for.
7. Back in your window, the candidate appears under "Who's here". Click **Start the interview**.
8. Check that both sides see, live: drawing by either side, the candidate's notes, chat and probe questions (red),
   phase changes and the timer, presence. Turn the network off and on in one window: "Reconnecting…", then it
   catches up.
9. End the interview. The candidate sees a thank-you; you go on to write your scorecard. The review shows
   **✓ Record verified**.
10. Submit your scorecard. The comparison table and the AI assessment section appear. If the AI keys are set,
    **Generate AI assessment** and check the result appears beside your scores.
11. Repeat with a **coding** round (check the candidate's typing appears live and the final code is on the review)
    and a **behavioural** round. Schedule two rounds at once to get a **loop**, and open its summary.

If something fails, see [Troubleshooting](#12-troubleshooting), and record it in
[`docs/company-platform/PROGRESS.md`](docs/company-platform/PROGRESS.md).

## 6. Deploy to Vercel

1. Import the repository in Vercel (framework preset: Next.js).
2. Add the variables from [section 4](#4-environment-variables). Set `NEXT_PUBLIC_SITE_URL` to the production URL.
3. Deploy, then in Supabase add `https://<your-domain>/**` to *Auth → URL configuration → Redirect URLs* and set the
   Site URL to your domain.
4. GitHub Pages can't run this app (it needs a server). Turn Pages off, or point the custom domain at Vercel.

## 7. Setting up your team

- **Sign up**: sign in with your work email (magic link or 6-digit code, or Google/GitHub if enabled). The first
  time, you create your company's workspace and become its **admin**.
- **Invite teammates**: **Team → Invite a teammate**, with their email and a role. Copy the link and send it; it
  works once, only for that address, for 7 days. Pending invites can be cancelled.
- **Roles**: both admins and interviewers add candidates, schedule and run interviews, and read submitted
  scorecards. Admins also manage the team, rename the workspace and delete candidates. A workspace always has at
  least one admin.
- **Problems**: browse the bank under **Problems**. Each problem's page shows the candidate prompt, how the time is
  split, and the full interviewer guide.

## 8. Running an interview

### Add the candidate and schedule

1. **Candidates → Add candidate**: name, email (needed for invites), the role, their **level** (it sets the time per
   phase) and private notes for the team.
2. On the candidate's page, **Schedule an interview**. For each round pick:
   - **Type**: system design (whiteboard), coding (shared editor) or behavioural (conversation).
   - **Problem** or question set: your team's own (★) first, then built-in ones suited to the level.
   - **Rubric**: the workspace default is preselected.
   - **Interviewers** (one or two) and optionally a **time** (needed for calendar invites).
3. **+ Add another round** to schedule a **loop** (up to 6 rounds at once) and give it a name. The loop page
   summarises every round. A candidate can have up to 8 open interviews.
4. The page then says what happened with invites: a Google Calendar event with a Meet link, `.ics` emails, or why
   nothing was sent.

### Before it starts

1. Open the interview (from the dashboard, **Interviews**, or the candidate's page). Assigned interviewers consent to
   recording and **Enter the room**. Another teammate can join instead while fewer than two have joined.
2. In the lobby, **Email link to …** sends the candidate their room link (when email is set up and they have an
   address), or **Create link to copy** to send it yourself. It works once, for 24 hours. **Make a new link**
   replaces it. The candidate doesn't need an account. If the interview has a Meet link, **Join the video call** is
   in the lobby and the room header for everyone.
3. When they appear under "Who's here", **Start the interview**. You can cancel from the lobby.

Talk over any call tool you like. The room records actions, not audio or video.

### What the candidate sees

They open the link, see your company's name, enter their name and consent to recording. In the room they get the
problem, their notes (you see them live), the shared whiteboard, the chat and the phase timer. They never see the
interviewer guide, your private notes, the candidate record or any score. When it ends they're thanked and told
your team will follow up. If they switch device, send a new link: it moves them over.

### In the room (interviewers)

- **Top:** the phase, time left in it (red when over), total time, connection, who's present. **Next: … →** or
  click a phase number to move; you can go back. **End interview** flushes pending saves first.
- **Left:** the problem, the candidate's notes, and the **Candidate link** panel (for a new link mid-interview).
- **Centre:** the round's workspace: the shared whiteboard (system design), the code editor (coding: the candidate
  types, you watch live; code isn't run, so ask them to walk through examples), or the conversation (behavioural).
- **Right**, three tabs:
  - **Conversation**: chat. Tick **Send as a probe question** to highlight a follow-up.
  - **Guide** (confidential): what the phase assesses and what "solid" looks like, follow-ups (click to stage one in
    the chat box), answers to clarifying questions, numbers for estimation, signals, pitfalls, reference design.
  - **Private notes**: evidence for your scorecard. Only you see them.

Tips: let the candidate drive; reveal requirements only when asked; note evidence with times as it happens.

### Your own problems and rubrics

- **Problems → New problem**: pick the round type, write the candidate prompt, levels, starter code (coding), and the
  guide: follow-ups, `question :: answer` clarifications, numbers or constraints, signals, pitfalls and a reference.
  Edits bump the version; interviews already scheduled keep the prompt they were created with. **Archive** hides a
  problem from scheduling.
- **Rubrics** (admins): start from the built-in rubric for a round type, rename, add or remove aspects (up to 12), and
  **Make default**. Each interview keeps a copy of its rubric, so changes never affect past scorecards.

### Calendar

- **Account → Connect Google Calendar** (each person who schedules). Interviews they schedule go on their calendar
  with a Meet link, and Google invites the interviewers and the candidate. Cancelling from the lobby removes it.
- **Team → Calendar invites** (admins): Google Calendar, `.ics` by email, or off. Anyone can **Add to my calendar
  (.ics)** from an interview's lobby.

## 9. Scoring and the AI assessment

Open the finished interview (the dashboard lists **Scorecards to write**). The review page has:

- **✓ Record verified**: the audit log's hash chain checks out. A red ✗ means the record was altered.
- **Your scorecard**: every aspect of the round's rubric scored 1–4 (1 no signal, 2 mixed, 3 solid for the level,
  4 strong) with evidence. Built-in rubrics: system design grades the six phases plus communication; coding grades
  problem solving, code quality, correctness & testing, complexity and communication; behavioural grades ownership,
  collaboration, judgement, impact, self-awareness and communication. Then a recommendation (Strong no / No / Yes /
  Strong yes) and a summary.
  **Save draft** keeps it private; **Submit** is final.
- **Release rules**: until you submit, you can't see colleagues' scorecards or the AI assessment. Teammates who
  weren't in the interview can read submitted ones. The candidate never sees any of it.
- **Comparison**: every submitted scorecard and the AI side by side, per aspect, with **split** where scores differ
  by two or more points: that's where to talk in the debrief.
- **AI assessment**: **Generate AI assessment** asks Claude to grade the recording on the same rubric. It reads the
  problem, the transcript with times, the candidate's notes, the final board and the timings, but not your private
  notes or anyone's scorecard. It's advisory: use it as a second opinion, not the decision. It can't hear anything
  said only on the call. One per interview; a failed run can be retried.
- **Loops**: the loop page shows every round side by side, per aspect, with a recommendation tally. Rounds you
  interviewed in stay hidden until you submit your scorecard for them.
- **Where the time went**, **Final board / code and notes**, **Transcript**, **What a strong answer covers**, **Audit log**
  and **Export full record (JSON)** (hiring team only).

## 10. Running the instance (admin tasks)

Run these in the Supabase SQL editor (as the `postgres` role).

```sql
-- Workspaces and their size
select o.name, count(m.*) as people, o.created_at
from public.organizations o left join public.org_members m on m.org_id = o.id
group by o.id order by o.created_at desc;

-- Recent interviews
select s.id, o.name as company, c.full_name as candidate, s.problem_title, s.status, s.end_reason, s.last_seq as events
from public.interview_sessions s
join public.organizations o on o.id = s.org_id
join public.candidates c on c.id = s.candidate_id
order by s.created_at desc limit 20;

-- The audit log of one interview
select seq, created_at, actor_role, type, phase, payload
from public.session_events where session_id = '<session-id>' order by seq;

-- AI assessments that failed
select session_id, error, requested_at from public.session_ai_assessments where status = 'failed';
```

**Verify a record's integrity** as an admin (`verify_session_log` checks the caller's access):

```sql
with recursive chain as (
  select e.*, public.session_genesis_hash(e.session_id) as expected_prev from public.session_events e
  where e.session_id = '<session-id>' and e.seq = 1
  union all
  select e.*, c.hash from public.session_events e join chain c on e.session_id = c.session_id and e.seq = c.seq + 1
)
select seq,
       prev_hash = expected_prev
         and hash = public.session_event_hash(prev_hash, session_id, seq, participant_id, type, visibility, phase, payload, created_at) as ok
from chain order by seq;
```

**Data deletion.** A candidate asking to be removed: an admin opens their page and **Delete candidate** (removes
every interview and scorecard for them). People delete their own accounts from **Account**; interviewers who leave
are anonymised as "Deleted user" and their records still verify. The last person in a workspace takes it with them.

**Limits** (enforced in the database): 50 people per workspace, 3 open interviews per candidate, 2 interviewers per
interview, 10,000 events per interview, 3,000 board elements, 20,000-character notes, 2,000-character chat messages.

## 11. Development workflow

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server at http://localhost:3000 |
| `npm test` | Unit tests + database tests (in-process Postgres via PGlite, no Docker needed) |
| `npm run lint` | ESLint (including the React Compiler rules) |
| `npm run typecheck` | Route type generation + `tsc --noEmit` |
| `npm run build` / `npm start` | Production build / serve it |

- **Change the schema:** add a new file in `supabase/migrations/` (don't edit applied ones) and cover it in
  `supabase/tests/`. Phases, aspects, event types, recommendations, roles and levels are repeated in SQL and
  TypeScript; a test fails if they differ.
- **Add or edit a problem:** edit `src/lib/problems/bank.ts` and bump its `version` if the meaning changes (sessions
  keep the version they used). `npm test` checks every problem has a complete guide.
- **Regenerate database types** once you have a project:
  `npx supabase gen types typescript --project-id <ref> > src/lib/database.types.ts`.
- **Record decisions** as a new ADR in `docs/adr/`, and progress in `docs/company-platform/PROGRESS.md`.

## 12. Troubleshooting

| Symptom | Likely cause and fix |
| --- | --- |
| `/login` says sign-in isn't connected | `.env.local` is missing the Supabase URL or key, or the dev server wasn't restarted |
| Magic link opens but says it's invalid or expired | It was opened in another browser with the default email template: use the template from [step 3.5](#option-a-hosted-supabase-project), or type the 6-digit code |
| No sign-in email arrives | The built-in sender is rate-limited: wait, or set up custom SMTP. Locally, check the mail viewer from `supabase status` |
| Redirect error after sign-in | Add your URL to *Auth → URL configuration → Redirect URLs* and set `NEXT_PUBLIC_SITE_URL` in production |
| Room stuck on "Connecting…" or "Reconnecting…", nothing updates live | Realtime isn't authorising: make sure every migration ran (the last one adds the `realtime.messages` policies). Check the browser console for channel errors |
| Others see your drawing but it's missing after refresh | Saving failed: look for "Board not saved yet, retrying…" and the console. Saves only work while the interview is running |
| "This candidate already has 8 open interviews" | Finish or cancel some from the candidate's page or **Interviews** |
| No calendar invite was sent | The page after scheduling says why: no time set, invites off, Google not connected (falls back to .ics), or email not set up |
| Google Calendar: "access was lost" | The grant was revoked or expired. **Account → Disconnect**, then connect again |
| Google consent screen says the app isn't verified | Add your team as test users on the OAuth consent screen, or complete Google's verification |
| Emails don't arrive | Check `EMAIL_PROVIDER`, `EMAIL_FROM` (verified domain) and the provider's logs; the server log shows the provider's error |
| Interviewer can't type in the code editor | By design: only the candidate types in coding rounds |
| Candidate says the link is used or expired | Links are single-use and last 24 hours. Make a new one in the lobby or the room's **Candidate link** panel |
| Candidate link says "This is the candidate's link" | You're signed in to the workspace. Send the link on, or open it in a private window |
| Candidate can't join: "We couldn't start your session" | Anonymous sign-ins are off in Supabase (*Auth → Sign In / Providers*), or rate-limited |
| Team invite says it's for another address | Sign out and sign in with the invited email |
| Start button stays disabled | The candidate hasn't joined. Send them the link |
| Can't submit a scorecard | Submission opens after the interview ends. It needs at least one score, a recommendation and a summary |
| "AI assessment isn't set up" | Add `ANTHROPIC_API_KEY` and `SUPABASE_SECRET_KEY`, then restart |
| AI assessment fails or times out | Retry. On hosts with short function limits, allow at least 120 s for Server Actions |
| Whiteboard text in a fallback font | Excalidraw loads its fonts from a CDN; check the network or a content blocker |
| Review shows ✗ Record failed verification | Event rows were altered outside the app. Export the record and investigate with the admin query above |
