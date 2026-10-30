# Probewise usage guide

How to set up Probewise, run it, and use it: as a candidate practising system design interviews, as an interviewer,
and as the person running the instance.

For architecture and design decisions see the [README](README.md),
[`docs/architecture/interview-sessions.md`](docs/architecture/interview-sessions.md) and [`docs/adr/`](docs/adr/).

> **Status:** milestones 1 (accounts, 100-seat cap, onboarding) and 2 (problem bank, shared interview room,
> recording, scoring) are built on `feature/phase1-m2-interview-room`. The interview room has been tested at the
> database level but **not yet end to end against a live Supabase project**. Treat your first peer session as that
> test (see [Verify your setup](#verify-your-setup)).

## Contents

1. [Prerequisites](#1-prerequisites)
2. [Install and run without a backend](#2-install-and-run-without-a-backend)
3. [Connect Supabase](#3-connect-supabase): [hosted](#option-a-hosted-supabase-project) or [local](#option-b-local-supabase-with-docker)
4. [Environment variables](#4-environment-variables)
5. [Verify your setup](#verify-your-setup)
6. [Deploy to Vercel](#6-deploy-to-vercel)
7. [Using Probewise as a candidate](#7-using-probewise-as-a-candidate)
8. [Using Probewise as an interviewer](#8-using-probewise-as-an-interviewer)
9. [Reviewing and scoring a session](#9-reviewing-and-scoring-a-session)
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
| Two browsers or profiles | To try a peer interview (one as candidate, one as interviewer) |

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
   1. `supabase/migrations/20261030000000_phase1_foundation.sql` (profiles, seat cap, waitlist)
   2. `supabase/migrations/20261030120000_m2_interview_sessions.sql` (sessions, audit log, evaluations, realtime policies)

   Or with the CLI:
   ```bash
   npx supabase login
   npx supabase link --project-ref <your-project-ref>
   npx supabase db push
   ```
3. **Copy the keys** from *Project Settings → API* into `.env.local`: the **Project URL** and the **publishable** key
   (`sb_publishable_…`; older projects call it the anon key). Never put the secret or service-role key in this app.
4. **Auth → URL configuration**
   - Site URL: `http://localhost:3000` for now (your production URL later)
   - Redirect URLs: `http://localhost:3000/**` (plus `https://<your-domain>/**` once deployed)
5. **Auth → Email templates → Magic link**: replace the body so the link works across devices and includes the code:
   ```html
   <h2>Sign in to Probewise</h2>
   <p><a href="{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=email">Sign in</a></p>
   <p>Or enter this code: <strong>{{ .Token }}</strong></p>
   ```
6. **Realtime (required for the interview room)**: in *Project Settings → Realtime*, turn **off** "Allow public
   access". The room uses private channels, which the migration's RLS policies on `realtime.messages` authorise.
7. **Email delivery**: the built-in sender allows only a few emails an hour, which is fine for testing. Before real
   users arrive, configure custom SMTP (Resend, Postmark, SES) under *Auth → SMTP*.
8. **Optional OAuth**: enable Google and/or GitHub under *Auth → Providers*, with callback
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
| `NEXT_PUBLIC_SITE_URL` | production | `https://probewise.vercel.app` | Canonical URL for magic-link and invite links. Leave empty locally |
| `NEXT_PUBLIC_AUTH_PROVIDERS` | no | `google,github` | OAuth buttons to show. Empty means email sign-in only |

Restart `npm run dev` after changing them.

## Verify your setup

Run this checklist once after connecting Supabase. Steps 4–8 are also the first live end-to-end test of the room.

1. `npm run dev`, open `http://localhost:3000`. The seat counter shows "100 seats left".
2. Sign in with your email (link or code). You land on **onboarding**; fill it in.
3. The dashboard lists **Problems queued for you**.
4. Open a problem, choose **With an interviewer**, tick the consent box, then **Open the interview room**.
5. In the lobby, click **Create invite link** and copy it.
6. In a **second browser or private window**, open the link and sign in with a *different* email. You should go
   straight to the invite page, **not** onboarding or the waitlist. Enter a name, consent, and join.
7. Back in the first browser, the interviewer appears under "Who's here". In the interviewer's browser, click
   **Start the interview**.
8. Check that both sides see, live:
   - shapes drawn on the board, by either side
   - the candidate's notes
   - chat messages and probe questions (red)
   - phase changes and the timer
   - presence (names without "(away)")

   Turn the network off and on in one browser: it should show "Reconnecting…" and then catch up.
9. End the interview. Both sides go to the review page, which shows **✓ Record verified**.
10. Submit the scorecard (interviewer) and the self-assessment (candidate). The candidate sees the scorecard only
    once it's submitted.

If something fails, see [Troubleshooting](#12-troubleshooting), and please record it in
[`docs/milestone-2/PROGRESS.md`](docs/milestone-2/PROGRESS.md).

## 6. Deploy to Vercel

1. Import the repository in Vercel (framework preset: Next.js).
2. Add the variables from [section 4](#4-environment-variables). Set `NEXT_PUBLIC_SITE_URL` to the production URL.
3. Deploy, then in Supabase add `https://<your-domain>/**` to *Auth → URL configuration → Redirect URLs* and set the
   Site URL to your domain.
4. GitHub Pages can't run this app (it needs a server). Turn Pages off, or point the custom domain at Vercel.

## 7. Using Probewise as a candidate

### Getting a seat

- Sign in with your email (magic link or 6-digit code) or Google/GitHub if enabled.
- The first 100 people get a seat. After that you join a first-come waitlist and get a seat when one frees up. Open
  `/waitlist` and press **Check for a seat**.
- Complete **onboarding**: role, level, up to 3 domains, focus areas, target companies, interview date. Problem
  recommendations and phase timings depend on these. You can change them later in **Profile**.

### Picking a problem

- **Dashboard → Problems queued for you** shows problems from your domains, or browse everything in **Problems**
  and filter by domain.
- A problem's page shows the scenario, the follow-up topics to expect, and how the minutes are split across the six
  phases at your level:

  | Phase | What to do |
  | --- | --- |
  | Requirements | Clarify features, users, scale and non-functional targets. Ask questions: interviewers have answers |
  | Estimation | Work out traffic, storage and the hot spots |
  | API & data model | Define endpoints and entities from the access patterns |
  | High-level design | Draw the components and data flow |
  | Deep dive | Go deep on the bottleneck, consistency and failures |
  | Trade-offs | Say what you traded away and what breaks first |

  Mid level and below get 45 minutes, senior 50, staff and principal 60.

### Starting a session

On the problem page choose:

- **With an interviewer (peer)**: you invite someone; they run the clock and score you.
- **Solo**: you run the clock and score yourself afterwards.

Tick the recording consent box and click **Open the interview room**. You can have up to 3 open sessions at once.

### Inviting an interviewer (peer)

1. In the lobby, click **Create invite link** and send it to your interviewer however you like.
2. The link works **once**, for **7 days**, and requires them to sign in. They don't need a seat.
3. **Make a new link** cancels the old one; **Cancel link** revokes it. Up to 2 interviewers can join.
4. Wait for them to start. You can **Cancel this session** from the lobby.

Talk over any call tool you like (Meet, Zoom, a phone). The room records actions, not audio or video.

### In the room

- **Left:** the problem, and **your notes**. They save automatically and the interviewer sees them live. Use them
  for requirements, estimates and APIs.
- **Centre:** the **shared whiteboard**. Both of you can draw. Changes save every couple of seconds; "Saving
  board…" appears while that happens.
- **Right:** **chat**. Interviewer follow-up questions appear in red as **Probe**. Enter sends, Shift+Enter adds a
  new line.
- **Top:** the current phase, the time left in it (red when over), the total time, the connection state, and who's
  present.
- In **solo** mode you control the phases (**Next: … →** or click a phase number) and **End interview**. In **peer**
  mode the interviewer controls them; you can **End early**, which ends the session for everyone.

Refreshing or briefly losing connection is safe: the room reloads its state and catches up on anything missed.

## 8. Using Probewise as an interviewer

1. Open the invite link and sign in (any email; you don't need a Probewise seat). Signing in through an invite never
   puts you on the waitlist.
2. Enter the name the candidate will see, consent to recording, and click **Join as interviewer**.
3. In the lobby, click **Start the interview** when you're both ready.
4. The right panel has three tabs:
   - **Conversation**: chat. Tick **Send as a probe question** to highlight a follow-up.
   - **Guide** (confidential, never shown to the candidate during the interview): what this phase assesses and what
     a "solid" answer looks like, problem-specific and general follow-ups (click one to put it in the chat box),
     answers to give when the candidate asks clarifying questions, numbers for estimation, strong signals, common
     pitfalls, and a reference design.
   - **Private notes**: your evidence for the scorecard. Only you can see them, and they save automatically.
5. Move through the phases with **Next: … →** or by clicking a phase number. You can go back.
6. Click **End interview** when done. Pending board, notes and private-note saves are flushed first.

Tips: let the candidate drive; reveal the requirements only when asked; write down evidence with the time as it
happens; ask follow-ups on whatever they glossed over.

## 9. Reviewing and scoring a session

Open **Sessions** (or the dashboard's "Past sessions") and pick a finished session. The review page has:

- **✓ Record verified**: the audit log's hash chain checks out, with the number of events and the chain head. A red
  ✗ means the record was altered.
- **Evaluation**:
  - **Interviewers** write a scorecard: 1–4 per phase (1 no signal, 2 mixed, 3 solid for the level, 4 strong),
    evidence for each, an overall recommendation (Strong no / No / Yes / Strong yes) and a summary.
  - **Candidates** write a self-assessment on the same scale.
  - **Save draft** keeps it private. **Submit** is final and can't be changed.
  - Release rules: the candidate sees interviewer scorecards once they're submitted; an interviewer sees other
    scorecards and the self-assessment only after submitting their own.
- **Where the time went**: planned vs actual time per phase (overruns in red), probes, board edits and messages per
  phase, the order the phases happened in, and when the first thing was drawn.
- **Final board and notes** (read-only), plus an interviewer's own private notes.
- **Transcript**: chat, probes and phase changes with times.
- **What a strong answer covers**: the problem's reference outline, strong signals and pitfalls.
- **Audit log**: every recorded event in order.
- **Export full record (JSON)**: the session, participants, every event you're allowed to see (including board
  deltas), evaluations and the integrity result. Candidates' exports never contain interviewers' private notes.

## 10. Running the instance (admin tasks)

Run these in the Supabase SQL editor (as the `postgres` role).

**Seats**

```sql
update public.app_config set seat_cap = 150;                  -- raise or lower the cap, no deploy
select count(*) from public.profiles;                         -- members
select * from public.waitlist order by joined_at;             -- queue
```

**Sessions**

```sql
-- Recent sessions with their state
select id, problem_title, mode, status, end_reason, created_at, last_seq as events
from public.interview_sessions order by created_at desc limit 20;

-- Participants of one session
select role, display_name, joined_at, consented_at
from public.session_participants where session_id = '<session-id>';

-- The audit log of one session
select seq, created_at, actor_role, type, phase, payload
from public.session_events where session_id = '<session-id>' order by seq;
```

**Verify a record's integrity.** `verify_session_log` runs as a participant, so as an admin recompute the chain
directly:

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

**Data deletion.** A member deletes their account from **Profile → Delete account**. This frees their seat and
deletes the sessions they were the candidate in. Interviewers who delete their accounts are anonymised as "Deleted
user" in sessions they took part in; those records still verify.

**Limits** (enforced in the database): 3 open sessions per candidate, 2 interviewers per session, 10,000 events per
session, 3,000 board elements, 20,000-character notes, 2,000-character chat messages.

## 11. Development workflow

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server at http://localhost:3000 |
| `npm test` | Unit tests + database tests (in-process Postgres via PGlite, no Docker needed) |
| `npm run lint` | ESLint (including the React Compiler rules) |
| `npm run typecheck` | Route type generation + `tsc --noEmit` |
| `npm run build` / `npm start` | Production build / serve it |

- **Change the schema:** add a new file in `supabase/migrations/` (don't edit applied ones) and cover it in
  `supabase/tests/`. Phases, event types and recommendations are repeated in SQL and TypeScript; a test fails if they
  differ.
- **Add or edit a problem:** edit `src/lib/problems/bank.ts` and bump its `version` if the meaning changes (sessions
  keep the version they used). `npm test` checks every problem has a complete guide.
- **Regenerate database types** once you have a project:
  `npx supabase gen types typescript --project-id <ref> > src/lib/database.types.ts`.
- **Record decisions** as a new ADR in `docs/adr/`, and progress in `docs/milestone-2/PROGRESS.md`.

## 12. Troubleshooting

| Symptom | Likely cause and fix |
| --- | --- |
| `/login` says sign-in isn't connected | `.env.local` is missing the Supabase URL or key, or the dev server wasn't restarted |
| Magic link opens but says it's invalid or expired | It was opened in another browser with the default email template: use the template from [step 3.5](#option-a-hosted-supabase-project), or type the 6-digit code |
| No sign-in email arrives | The built-in sender is rate-limited: wait, or set up custom SMTP. Locally, check the mail viewer from `supabase status` |
| Redirect error after sign-in | Add your URL to *Auth → URL configuration → Redirect URLs* and set `NEXT_PUBLIC_SITE_URL` in production |
| Room stuck on "Connecting…" or "Reconnecting…", nothing updates live | Realtime isn't authorising: make sure both migrations ran (the second adds the `realtime.messages` policies), and that you're signed in. Check the browser console for channel errors |
| Others see your drawing but it's missing after refresh | Saving failed: look for "Board not saved yet, retrying…" and the console. Saves only work while the session is running |
| "You already have 3 open sessions" | Finish or cancel one from **Sessions** |
| Invite link says it was already used or expired | Links are single-use and last 7 days. The candidate makes a new one in the lobby |
| "You can't interview yourself" | You opened your own invite. Use a different account in another browser |
| Interviewer ended up on the waitlist | They signed in from somewhere other than the invite link. Open the invite link again while signed in |
| Can't submit a scorecard | Submission opens after the session ends. A scorecard needs at least one phase score, a recommendation and a summary |
| Whiteboard text in a fallback font | Excalidraw loads its fonts from a CDN; check the network or a content blocker |
| Review shows ✗ Record failed verification | Event rows were altered outside the app. Export the record and investigate with the admin query above |
