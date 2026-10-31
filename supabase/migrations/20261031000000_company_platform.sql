-- Probewise · Company platform
-- Turns Probewise from a candidate practice tool into a hiring platform:
--
--   * A company signs up and gets a workspace (organizations). Teammates join by
--     invite as admins or interviewers (org_members, org_invites).
--   * The company adds candidates (candidates) and schedules interviews for them,
--     assigning 1–2 interviewers from the workspace.
--   * During the interview an interviewer sends the candidate a one-time link
--     (candidate_links). The candidate joins without an account (a Supabase
--     anonymous session) and never sees scorecards.
--   * Interviewers grade the candidate on each aspect of the rubric. An advisory AI
--     assessment can be generated afterwards (session_ai_assessments). Candidates
--     no longer self-assess.
--
-- Replaces milestone 1's seat cap, waitlist and candidate profile, and rebuilds
-- milestone 2's session schema around workspaces. Existing sessions are dropped:
-- they belong to individual candidates and have no company to move to.
--
-- Design: docs/architecture/interview-sessions.md · Decisions: docs/adr/0001–0009

-- ---------------------------------------------------------------------------
-- Tear down the candidate-centred model
-- ---------------------------------------------------------------------------

drop policy if exists "Session participants can receive session broadcasts" on realtime.messages;
drop policy if exists "Session participants can send live board and presence updates" on realtime.messages;

-- Tables first: their policies use the functions below.
drop table if exists
  public.session_evaluations, public.session_interviewer_notes, public.session_events,
  public.session_invites, public.session_participants, public.interview_sessions
  cascade;

drop function if exists
  public.create_session(text, text, integer, text, jsonb, jsonb, text, boolean),
  public.create_session_invite(uuid, text, integer),
  public.revoke_session_invites(uuid),
  public.session_invite_preview(text),
  public.accept_session_invite(text, text, boolean),
  public.start_session(uuid),
  public.change_session_phase(uuid, text),
  public.end_session(uuid),
  public.record_event(uuid, text, jsonb, timestamptz),
  public.save_evaluation(uuid, jsonb, text, text, boolean),
  public.verify_session_log(uuid),
  public.require_participant(uuid),
  public.append_session_event(uuid, uuid, text, text, jsonb, text, timestamptz),
  public.realtime_topic_allowed(text, boolean),
  public.can_read_evaluation(uuid, uuid, timestamptz),
  public.session_controller_role(text),
  public.session_participant_id(uuid),
  public.session_role(uuid);

drop trigger if exists on_auth_user_email_changed on auth.users;
drop function if exists
  public.sync_user_email(),
  public.claim_seat(),
  public.seats_remaining(),
  public.waitlist_status(),
  public.delete_my_account();
drop table if exists public.waitlist, public.profiles, public.app_config cascade;

-- ---------------------------------------------------------------------------
-- Vocabularies (keep in sync with src/lib; tests check this)
-- ---------------------------------------------------------------------------

-- What a scorecard grades: every phase of the interview, plus communication
-- throughout (src/lib/interview/rubric.ts ASPECTS).
create or replace function public.evaluation_aspects()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select public.interview_phases() || array['communication']::text[]
$$;

create or replace function public.email_valid(p_email text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select char_length(p_email) <= 254 and p_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
$$;

-- ---------------------------------------------------------------------------
-- organizations, org_members, org_invites
-- ---------------------------------------------------------------------------

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger organizations_updated_at
  before update on public.organizations
  for each row execute function public.set_updated_at();

create table public.org_members (
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- keep in sync with ORG_ROLES in src/lib/org.ts
  role text not null check (role in ('admin', 'interviewer')),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 80),
  email text,
  joined_at timestamptz not null default now(),
  primary key (org_id, user_id),
  -- One workspace per account for now; lifting this needs a workspace switcher.
  unique (user_id)
);

create table public.org_invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  email text not null check (public.email_valid(email)),
  role text not null check (role in ('admin', 'interviewer')),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz,
  check (expires_at > created_at)
);

create index org_invites_org_idx on public.org_invites (org_id, created_at desc);

-- ---------------------------------------------------------------------------
-- candidates: people the company is interviewing. Not accounts.
-- ---------------------------------------------------------------------------

create table public.candidates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  full_name text not null check (char_length(btrim(full_name)) between 1 and 100),
  email text check (email is null or public.email_valid(email)),
  role_title text check (role_title is null or char_length(btrim(role_title)) between 1 and 100),
  -- keep in sync with SENIORITY_LEVELS in src/lib/profile-options.ts (a test checks this)
  seniority text check (seniority in ('entry', 'mid', 'senior', 'staff', 'principal')),
  notes text not null default '' check (char_length(notes) <= 5000),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index candidates_org_idx on public.candidates (org_id, created_at desc);
create unique index candidates_org_email_unique on public.candidates (org_id, lower(email)) where email is not null;

create trigger candidates_updated_at
  before update on public.candidates
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Workspace access helpers
-- ---------------------------------------------------------------------------

create or replace function public.is_anonymous_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select is_anonymous from auth.users where id = (select auth.uid())), false)
$$;

create or replace function public.my_org_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select org_id from public.org_members where user_id = (select auth.uid())
$$;

create or replace function public.is_org_member(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.org_members where org_id = p_org and user_id = (select auth.uid()))
$$;

create or replace function public.is_org_admin(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.org_members where org_id = p_org and user_id = (select auth.uid()) and role = 'admin'
  )
$$;

-- The caller's membership, or an error. Anonymous (candidate) sessions never qualify.
create or replace function public.require_member()
returns public.org_members
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me public.org_members;
begin
  if (select auth.uid()) is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  select * into v_me from public.org_members where user_id = (select auth.uid());
  if not found then
    raise exception 'You''re not part of a workspace' using errcode = '42501';
  end if;
  return v_me;
end;
$$;

-- ---------------------------------------------------------------------------
-- Workspace lifecycle
-- ---------------------------------------------------------------------------

create or replace function public.create_organization(p_name text, p_display_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if public.is_anonymous_user() then
    raise exception 'Sign in with your work email to create a workspace' using errcode = '42501';
  end if;
  if exists (select 1 from public.org_members where user_id = v_uid) then
    raise exception 'You''re already part of a workspace' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 100 then
    raise exception 'Enter your company name (up to 100 characters)' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_display_name, ''))) not between 1 and 80 then
    raise exception 'Enter your name (up to 80 characters)' using errcode = '22023';
  end if;

  insert into public.organizations (name) values (btrim(p_name)) returning id into v_org;
  insert into public.org_members (org_id, user_id, role, display_name, email)
  values (v_org, v_uid, 'admin', btrim(p_display_name), (select email from auth.users where id = v_uid));
  return v_org;
end;
$$;

create or replace function public.update_my_display_name(p_display_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.org_members := public.require_member();
begin
  if char_length(btrim(coalesce(p_display_name, ''))) not between 1 and 80 then
    raise exception 'Enter your name (up to 80 characters)' using errcode = '22023';
  end if;
  update public.org_members set display_name = btrim(p_display_name)
  where org_id = v_me.org_id and user_id = v_me.user_id;
end;
$$;

-- Team invites: one-time links bound to an email address. Admins only.
create or replace function public.create_org_invite(p_email text, p_role text, p_token_hash text)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.org_members := public.require_member();
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_expires timestamptz := now() + interval '7 days';
begin
  if v_me.role <> 'admin' then
    raise exception 'Only admins can invite teammates' using errcode = '42501';
  end if;
  if not public.email_valid(v_email) then
    raise exception 'Enter a valid email address' using errcode = '22023';
  end if;
  if p_role not in ('admin', 'interviewer') then
    raise exception 'Unknown role' using errcode = '22023';
  end if;
  if exists (select 1 from public.org_members where org_id = v_me.org_id and lower(email) = v_email) then
    raise exception 'That person is already in your workspace' using errcode = '22023';
  end if;
  if (select count(*) from public.org_members where org_id = v_me.org_id) >= 50 then
    raise exception 'Workspaces are limited to 50 people for now' using errcode = '54000';
  end if;

  -- A new invite for the same address replaces any pending one.
  update public.org_invites set revoked_at = now()
  where org_id = v_me.org_id and lower(email) = v_email and accepted_at is null and revoked_at is null;

  insert into public.org_invites (org_id, email, role, token_hash, created_by, expires_at)
  values (v_me.org_id, v_email, p_role, p_token_hash, v_me.user_id, v_expires);
  return v_expires;
end;
$$;

create or replace function public.revoke_org_invite(p_invite uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.org_members := public.require_member();
begin
  if v_me.role <> 'admin' then
    raise exception 'Only admins can manage invites' using errcode = '42501';
  end if;
  update public.org_invites set revoked_at = now()
  where id = p_invite and org_id = v_me.org_id and accepted_at is null and revoked_at is null;
end;
$$;

create or replace function public.org_invite_preview(p_token_hash text)
returns table (org_name text, email text, role text, invite_state text, email_matches boolean, already_member boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_inv public.org_invites;
begin
  if (select auth.uid()) is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  select * into v_inv from public.org_invites where token_hash = p_token_hash;
  if not found then return; end if;

  org_name := (select name from public.organizations where id = v_inv.org_id);
  email := v_inv.email;
  role := v_inv.role;
  invite_state := case
    when v_inv.accepted_at is not null then 'used'
    when v_inv.revoked_at is not null then 'revoked'
    when v_inv.expires_at <= now() then 'expired'
    else 'valid'
  end;
  email_matches := lower(coalesce((select u.email from auth.users u where u.id = (select auth.uid())), '')) = lower(v_inv.email);
  already_member := exists (select 1 from public.org_members where user_id = (select auth.uid()));
  return next;
end;
$$;

create or replace function public.accept_org_invite(p_token_hash text, p_display_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_inv public.org_invites;
  v_email text;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if public.is_anonymous_user() then
    raise exception 'Sign in with your work email to join the workspace' using errcode = '42501';
  end if;
  select * into v_inv from public.org_invites where token_hash = p_token_hash for update;
  if not found then
    raise exception 'This invite link isn''t valid' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.org_members where user_id = v_uid and org_id = v_inv.org_id) then
    return v_inv.org_id; -- clicked the link twice
  end if;
  if exists (select 1 from public.org_members where user_id = v_uid) then
    raise exception 'You''re already part of another workspace' using errcode = '22023';
  end if;
  if v_inv.accepted_at is not null or v_inv.revoked_at is not null or v_inv.expires_at <= now() then
    raise exception 'This invite has expired or was already used. Ask an admin for a new one' using errcode = '22023';
  end if;
  select email into v_email from auth.users where id = v_uid;
  if lower(coalesce(v_email, '')) <> lower(v_inv.email) then
    raise exception 'This invite is for %. Sign in with that address', v_inv.email using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_display_name, ''))) not between 1 and 80 then
    raise exception 'Enter your name (up to 80 characters)' using errcode = '22023';
  end if;

  insert into public.org_members (org_id, user_id, role, display_name, email)
  values (v_inv.org_id, v_uid, v_inv.role, btrim(p_display_name), v_email);
  update public.org_invites set accepted_at = now(), accepted_by = v_uid where id = v_inv.id;
  return v_inv.org_id;
end;
$$;

create or replace function public.set_org_member_role(p_user uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.org_members := public.require_member();
begin
  if v_me.role <> 'admin' then
    raise exception 'Only admins can change roles' using errcode = '42501';
  end if;
  if p_role not in ('admin', 'interviewer') then
    raise exception 'Unknown role' using errcode = '22023';
  end if;
  if p_role = 'interviewer' and (
    select count(*) from public.org_members where org_id = v_me.org_id and role = 'admin' and user_id <> p_user
  ) = 0 then
    raise exception 'A workspace needs at least one admin' using errcode = '22023';
  end if;
  update public.org_members set role = p_role where org_id = v_me.org_id and user_id = p_user;
  if not found then
    raise exception 'That person isn''t in your workspace' using errcode = 'P0002';
  end if;
end;
$$;

-- Removing someone keeps their past interviews and scorecards (participant rows
-- aren't tied to the membership); they just lose access to the workspace.
create or replace function public.remove_org_member(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.org_members := public.require_member();
begin
  if v_me.role <> 'admin' then
    raise exception 'Only admins can remove people' using errcode = '42501';
  end if;
  if p_user = v_me.user_id then
    raise exception 'You can''t remove yourself. Delete your account from the account page instead' using errcode = '22023';
  end if;
  delete from public.org_members where org_id = v_me.org_id and user_id = p_user;
  if not found then
    raise exception 'That person isn''t in your workspace' using errcode = 'P0002';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- interview_sessions: one interview of one candidate on one problem
-- ---------------------------------------------------------------------------

create table public.interview_sessions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  candidate_id uuid not null references public.candidates (id) on delete cascade,
  created_by uuid references auth.users (id) on delete set null,
  scheduled_at timestamptz,
  status text not null default 'lobby' check (status in ('lobby', 'in_progress', 'completed', 'cancelled')),
  problem_slug text not null check (char_length(problem_slug) <= 80 and problem_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  problem_version integer not null check (problem_version between 1 and 10000),
  problem_title text not null check (char_length(btrim(problem_title)) between 1 and 200),
  -- The candidate-facing prompt as it was when the session was created (ADR 0004).
  problem_snapshot jsonb not null check (
    jsonb_typeof(problem_snapshot) = 'object' and octet_length(problem_snapshot::text) <= 32768
  ),
  phase_plan jsonb not null check (public.phase_plan_valid(phase_plan)),
  phase text check (phase = any (public.interview_phases())),
  phase_started_at timestamptz,
  started_at timestamptz,
  ended_at timestamptz,
  end_reason text check (end_reason in ('completed', 'ended_early', 'cancelled')),
  -- Materialised current state; session_events is the source of truth.
  board jsonb not null default '[]' check (jsonb_typeof(board) = 'array' and octet_length(board::text) <= 2097152),
  notes text not null default '' check (char_length(notes) <= 20000),
  last_seq bigint not null default 0,
  last_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint session_status_coherent check (
    (status = 'lobby' and started_at is null and ended_at is null and phase is null and end_reason is null)
    or (status = 'in_progress' and started_at is not null and ended_at is null
        and phase is not null and phase_started_at is not null and end_reason is null)
    or (status = 'completed' and started_at is not null and ended_at is not null
        and end_reason in ('completed', 'ended_early'))
    or (status = 'cancelled' and started_at is null and ended_at is not null and end_reason = 'cancelled')
  )
);

create index interview_sessions_org_idx on public.interview_sessions (org_id, created_at desc);
create index interview_sessions_candidate_idx on public.interview_sessions (candidate_id, created_at desc);

create trigger interview_sessions_updated_at
  before update on public.interview_sessions
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- session_participants
-- Interviewers are assigned when the interview is scheduled (joined_at null) and
-- join when they consent in the room. The candidate's row is created when they
-- open their link. Events reference participants, not users, so the log stays
-- verifiable after an account is deleted (ADR 0005).
-- ---------------------------------------------------------------------------

create table public.session_participants (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.interview_sessions (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  role text not null check (role in ('candidate', 'interviewer')),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 80),
  consented_at timestamptz,
  joined_at timestamptz,
  created_at timestamptz not null default now(),
  unique (session_id, user_id),
  check ((consented_at is null) = (joined_at is null))
);

create unique index session_participants_one_candidate on public.session_participants (session_id)
  where role = 'candidate';
create index session_participants_user_idx on public.session_participants (user_id);

create or replace function public.anonymize_participant()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.user_id is null and old.user_id is not null then
    new.display_name := 'Deleted user';
  end if;
  return new;
end;
$$;

create trigger session_participants_anonymize
  before update of user_id on public.session_participants
  for each row execute function public.anonymize_participant();

-- ---------------------------------------------------------------------------
-- candidate_links: one-time links that let the candidate into the room. Only the
-- SHA-256 of the token is stored; the token is shown once to the interviewer.
-- ---------------------------------------------------------------------------

create table public.candidate_links (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.interview_sessions (id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  accepted_at timestamptz,
  accepted_by uuid references public.session_participants (id) on delete cascade,
  check (expires_at > created_at),
  check ((accepted_at is null) = (accepted_by is null))
);

create index candidate_links_session_idx on public.candidate_links (session_id);

-- ---------------------------------------------------------------------------
-- session_events: the append-only, hash-chained audit log (ADR 0001)
-- ---------------------------------------------------------------------------

create table public.session_events (
  session_id uuid not null references public.interview_sessions (id) on delete cascade,
  seq bigint not null check (seq >= 1),
  participant_id uuid references public.session_participants (id),
  -- 'member': someone from the workspace acting on the session without taking part in it
  actor_role text not null check (actor_role in ('candidate', 'interviewer', 'member', 'system')),
  -- keep in sync with EVENT_TYPES in src/lib/interview/events.ts
  type text not null check (type in (
    'session.created', 'participant.joined', 'consent.given', 'candidate_link.created', 'candidate_links.revoked',
    'session.started', 'phase.changed', 'session.ended',
    'chat.message', 'probe.asked', 'notes.updated', 'board.updated',
    'interviewer_note.updated', 'evaluation.submitted', 'ai_assessment.completed'
  )),
  visibility text not null default 'all' check (visibility in ('all', 'interviewers')),
  phase text,
  payload jsonb not null default '{}' check (
    jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 262144
  ),
  client_ts timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  prev_hash text not null,
  hash text not null,
  primary key (session_id, seq)
);

create index session_events_type_idx on public.session_events (session_id, type);

create trigger session_events_no_update
  before update on public.session_events
  for each row execute function public.reject_event_mutation();

create trigger session_events_no_truncate
  before truncate on public.session_events
  for each statement execute function public.reject_event_mutation();

-- ---------------------------------------------------------------------------
-- session_interviewer_notes: each interviewer's private notes
-- ---------------------------------------------------------------------------

create table public.session_interviewer_notes (
  session_id uuid not null references public.interview_sessions (id) on delete cascade,
  participant_id uuid not null references public.session_participants (id) on delete cascade,
  body text not null default '' check (char_length(body) <= 20000),
  updated_at timestamptz not null default now(),
  primary key (session_id, participant_id)
);

-- ---------------------------------------------------------------------------
-- session_evaluations: interviewer scorecards (ADR 0006). Immutable once submitted.
-- ---------------------------------------------------------------------------

create table public.session_evaluations (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.interview_sessions (id) on delete cascade,
  participant_id uuid not null references public.session_participants (id) on delete cascade,
  -- {"<aspect>": {"score": 1-4 | null, "evidence": "…"}}
  scores jsonb not null default '{}' check (jsonb_typeof(scores) = 'object'),
  -- keep in sync with RECOMMENDATIONS in src/lib/interview/rubric.ts
  recommendation text check (recommendation in ('strong_no', 'no', 'yes', 'strong_yes')),
  summary text not null default '' check (char_length(summary) <= 5000),
  rubric_version smallint not null default 2,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, participant_id)
);

create trigger session_evaluations_immutable
  before update on public.session_evaluations
  for each row execute function public.reject_submitted_evaluation_change();

-- ---------------------------------------------------------------------------
-- session_ai_assessments: an advisory, AI-generated scorecard (ADR 0009).
-- Written only by the server (service role) after the interview ends.
-- ---------------------------------------------------------------------------

create table public.session_ai_assessments (
  session_id uuid primary key references public.interview_sessions (id) on delete cascade,
  status text not null check (status in ('running', 'completed', 'failed')),
  model text check (model is null or char_length(model) <= 100),
  scores jsonb not null default '{}' check (jsonb_typeof(scores) = 'object'),
  recommendation text check (recommendation in ('strong_no', 'no', 'yes', 'strong_yes')),
  summary text not null default '' check (char_length(summary) <= 5000),
  strengths text[] not null default '{}' check (cardinality(strengths) <= 10),
  concerns text[] not null default '{}' check (cardinality(concerns) <= 10),
  error text check (error is null or char_length(error) <= 500),
  rubric_version smallint not null default 2,
  requested_by uuid references auth.users (id) on delete set null,
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  check (status <> 'completed' or (completed_at is not null and recommendation is not null))
);

-- ---------------------------------------------------------------------------
-- Session access helpers (used by RLS policies and the functions below)
-- ---------------------------------------------------------------------------

-- The caller's role in a session once they've joined it, or null.
create or replace function public.session_role(p_session uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.session_participants
  where session_id = p_session and user_id = (select auth.uid()) and joined_at is not null
$$;

create or replace function public.session_participant_id(p_session uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.session_participants
  where session_id = p_session and user_id = (select auth.uid()) and joined_at is not null
$$;

-- True when the caller is a candidate who has joined one of the workspace's interviews:
-- they may read the company's name, nothing else about it.
create or replace function public.is_org_candidate(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.session_participants p
    join public.interview_sessions s on s.id = p.session_id
    where s.org_id = p_org and p.user_id = (select auth.uid()) and p.role = 'candidate' and p.joined_at is not null
  )
$$;

-- True when the caller belongs to the workspace that owns the session.
create or replace function public.session_org_member(p_session uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.interview_sessions s
    join public.org_members m on m.org_id = s.org_id
    where s.id = p_session and m.user_id = (select auth.uid())
  )
$$;

create or replace function public.can_view_session(p_session uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.session_role(p_session) is not null or public.session_org_member(p_session)
$$;

-- Anti-anchoring (ADR 0006): the workspace sees submitted scorecards and the AI
-- assessment, except an interviewer who took part and hasn't submitted their own yet.
-- The candidate never sees either.
create or replace function public.review_unlocked(p_session uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.session_org_member(p_session)
    and not exists (
      select 1 from public.session_participants p
      where p.session_id = p_session and p.user_id = (select auth.uid())
        and p.role = 'interviewer' and p.joined_at is not null
        and not exists (
          select 1 from public.session_evaluations e
          where e.session_id = p_session and e.participant_id = p.id and e.submitted_at is not null
        )
    )
$$;

create or replace function public.can_read_evaluation(p_session uuid, p_author uuid, p_submitted_at timestamptz)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_author = public.session_participant_id(p_session) then true
    when p_submitted_at is null then false
    else public.review_unlocked(p_session)
  end
$$;

-- Realtime topics: 'session:<id>' (everyone who has joined) and
-- 'session:<id>:interviewers'. Clients may send (ephemeral board deltas, presence)
-- only on the main topic while the session is open.
create or replace function public.realtime_topic_allowed(p_topic text, p_send boolean)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_match text[];
  v_session uuid;
  v_role text;
begin
  v_match := regexp_match(p_topic, '^session:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(:interviewers)?$');
  if v_match is null then return false; end if;
  v_session := v_match[1]::uuid;
  v_role := public.session_role(v_session);
  if v_role is null then return false; end if;
  if v_match[2] is not null then
    return v_role = 'interviewer' and not p_send;
  end if;
  if p_send then
    return exists (select 1 from public.interview_sessions where id = v_session and status in ('lobby', 'in_progress'));
  end if;
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- append_session_event(): the only writer of session_events (internal)
-- ---------------------------------------------------------------------------

create or replace function public.append_session_event(
  p_session uuid,
  p_participant uuid,
  p_actor_role text,
  p_type text,
  p_payload jsonb,
  p_visibility text default 'all',
  p_client_ts timestamptz default null
)
returns public.session_events
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.interview_sessions;
  v_event public.session_events;
begin
  select * into v_session from public.interview_sessions where id = p_session for update;
  if not found then
    raise exception 'Session not found' using errcode = 'P0002';
  end if;
  if v_session.last_seq >= 10000 then
    raise exception 'This session has reached its event limit' using errcode = '54000';
  end if;

  v_event.session_id := p_session;
  v_event.seq := v_session.last_seq + 1;
  v_event.participant_id := p_participant;
  v_event.actor_role := p_actor_role;
  v_event.type := p_type;
  v_event.visibility := p_visibility;
  v_event.phase := v_session.phase;
  v_event.payload := coalesce(p_payload, '{}'::jsonb);
  v_event.client_ts := case
    when p_client_ts between now() - interval '1 day' and now() + interval '1 day' then p_client_ts
  end;
  v_event.created_at := date_trunc('microseconds', clock_timestamp());
  v_event.prev_hash := v_session.last_hash;
  v_event.hash := public.session_event_hash(
    v_event.prev_hash, v_event.session_id, v_event.seq, v_event.participant_id, v_event.type,
    v_event.visibility, v_event.phase, v_event.payload, v_event.created_at
  );

  insert into public.session_events values (v_event.*);
  update public.interview_sessions set last_seq = v_event.seq, last_hash = v_event.hash where id = p_session;

  begin
    perform realtime.send(
      jsonb_build_object(
        'seq', v_event.seq,
        'type', v_event.type,
        'participant_id', v_event.participant_id,
        'actor_role', v_event.actor_role,
        'visibility', v_event.visibility,
        'phase', v_event.phase,
        'payload', v_event.payload,
        'created_at', v_event.created_at
      ),
      'event',
      'session:' || p_session::text || case when p_visibility = 'interviewers' then ':interviewers' else '' end,
      true
    );
  exception when others then
    raise warning 'realtime.send failed for session % seq %: %', p_session, v_event.seq, sqlerrm;
  end;

  return v_event;
end;
$$;

-- The caller's participant row (joined), or an error.
create or replace function public.require_participant(p_session uuid)
returns public.session_participants
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me public.session_participants;
begin
  if (select auth.uid()) is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  select * into v_me from public.session_participants
  where session_id = p_session and user_id = (select auth.uid()) and joined_at is not null;
  if not found then
    raise exception 'You are not part of this session' using errcode = '42501';
  end if;
  return v_me;
end;
$$;

-- ---------------------------------------------------------------------------
-- create_session(): a workspace member schedules an interview for a candidate
-- ---------------------------------------------------------------------------

create or replace function public.create_session(
  p_candidate uuid,
  p_problem_slug text,
  p_problem_version integer,
  p_problem_title text,
  p_problem_snapshot jsonb,
  p_phase_plan jsonb,
  p_interviewers uuid[],
  p_scheduled_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.org_members := public.require_member();
  v_session uuid := gen_random_uuid();
  v_interviewers uuid[] := array(select distinct unnest(coalesce(p_interviewers, '{}'::uuid[])));
  v_names jsonb;
begin
  if not exists (select 1 from public.candidates where id = p_candidate and org_id = v_me.org_id) then
    raise exception 'That candidate isn''t in your workspace' using errcode = 'P0002';
  end if;
  if cardinality(v_interviewers) not between 1 and 2 then
    raise exception 'Pick one or two interviewers' using errcode = '22023';
  end if;
  if (select count(*) from public.org_members where org_id = v_me.org_id and user_id = any (v_interviewers))
     <> cardinality(v_interviewers) then
    raise exception 'Interviewers must be in your workspace' using errcode = '22023';
  end if;
  if p_scheduled_at is not null and p_scheduled_at not between now() - interval '1 day' and now() + interval '1 year' then
    raise exception 'Pick a date within the next year' using errcode = '22023';
  end if;
  if (select count(*) from public.interview_sessions
      where candidate_id = p_candidate and status in ('lobby', 'in_progress')) >= 3 then
    raise exception 'This candidate already has 3 open interviews. Finish or cancel one first' using errcode = '54000';
  end if;

  insert into public.interview_sessions (
    id, org_id, candidate_id, created_by, scheduled_at, problem_slug, problem_version, problem_title,
    problem_snapshot, phase_plan, last_hash
  ) values (
    v_session, v_me.org_id, p_candidate, v_me.user_id, p_scheduled_at, p_problem_slug, p_problem_version,
    btrim(p_problem_title), p_problem_snapshot, p_phase_plan, public.session_genesis_hash(v_session)
  );

  insert into public.session_participants (session_id, user_id, role, display_name)
  select v_session, m.user_id, 'interviewer', m.display_name
  from public.org_members m
  where m.org_id = v_me.org_id and m.user_id = any (v_interviewers);

  select jsonb_agg(display_name order by display_name) into v_names
  from public.session_participants where session_id = v_session;

  perform public.append_session_event(v_session, null, 'member', 'session.created', jsonb_build_object(
    'by', v_me.display_name, 'problem_slug', p_problem_slug, 'problem_version', p_problem_version,
    'problem_title', btrim(p_problem_title), 'phase_plan', p_phase_plan,
    'interviewers', v_names, 'scheduled_at', p_scheduled_at
  ));
  return v_session;
end;
$$;

-- An interviewer enters the room: an assigned interviewer consents and joins, or
-- another workspace member steps in while fewer than two interviewers have joined.
create or replace function public.join_session(p_session uuid, p_consent boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.org_members := public.require_member();
  v_session public.interview_sessions;
  v_part public.session_participants;
begin
  select * into v_session from public.interview_sessions where id = p_session for update;
  if not found or v_session.org_id <> v_me.org_id then
    raise exception 'Session not found' using errcode = 'P0002';
  end if;
  select * into v_part from public.session_participants where session_id = p_session and user_id = v_me.user_id;
  if found and v_part.role = 'candidate' then
    raise exception 'You''re the candidate in this interview' using errcode = '22023';
  end if;
  if found and v_part.joined_at is not null then
    return;
  end if;
  if v_session.status not in ('lobby', 'in_progress') then
    raise exception 'This interview has ended' using errcode = '22023';
  end if;
  if p_consent is not true then
    raise exception 'Recording consent is required' using errcode = '22023';
  end if;
  if (select count(*) from public.session_participants
      where session_id = p_session and role = 'interviewer' and joined_at is not null) >= 2 then
    raise exception 'Two interviewers have already joined' using errcode = '54000';
  end if;

  if v_part.id is null then
    insert into public.session_participants (session_id, user_id, role, display_name, consented_at, joined_at)
    values (p_session, v_me.user_id, 'interviewer', v_me.display_name, now(), now())
    returning * into v_part;
  else
    update public.session_participants set consented_at = now(), joined_at = now(), display_name = v_me.display_name
    where id = v_part.id
    returning * into v_part;
  end if;

  perform public.append_session_event(p_session, v_part.id, 'interviewer', 'participant.joined',
    jsonb_build_object('role', 'interviewer', 'display_name', v_part.display_name));
  perform public.append_session_event(p_session, v_part.id, 'interviewer', 'consent.given',
    jsonb_build_object('consent_version', 2));
end;
$$;

-- ---------------------------------------------------------------------------
-- Candidate links
-- ---------------------------------------------------------------------------

-- Who is acting on a session from the workspace side: their participant row if
-- they've joined as an interviewer, otherwise 'member'. Errors for anyone else.
create or replace function public.require_session_staff(p_session uuid, out participant_id uuid, out actor_role text, out display_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_part public.session_participants;
  v_member public.org_members;
begin
  if (select auth.uid()) is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  select * into v_part from public.session_participants
  where session_id = p_session and user_id = (select auth.uid()) and joined_at is not null;
  if found and v_part.role = 'interviewer' then
    participant_id := v_part.id;
    actor_role := 'interviewer';
    display_name := v_part.display_name;
    return;
  end if;
  select m.* into v_member from public.org_members m
  join public.interview_sessions s on s.org_id = m.org_id
  where s.id = p_session and m.user_id = (select auth.uid());
  if not found then
    raise exception 'Only the hiring team can do that' using errcode = '42501';
  end if;
  participant_id := null;
  actor_role := 'member';
  display_name := v_member.display_name;
end;
$$;

create or replace function public.create_candidate_link(p_session uuid, p_token_hash text, p_ttl_hours integer default 24)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff record := public.require_session_staff(p_session);
  v_session public.interview_sessions;
  v_expires timestamptz := now() + make_interval(hours => least(greatest(coalesce(p_ttl_hours, 24), 1), 168));
begin
  select * into v_session from public.interview_sessions where id = p_session for update;
  if v_session.status not in ('lobby', 'in_progress') then
    raise exception 'This interview has ended' using errcode = '22023';
  end if;

  update public.candidate_links set revoked_at = now()
  where session_id = p_session and revoked_at is null and accepted_at is null;

  insert into public.candidate_links (session_id, token_hash, created_by, expires_at)
  values (p_session, p_token_hash, (select auth.uid()), v_expires);

  perform public.append_session_event(p_session, v_staff.participant_id, v_staff.actor_role, 'candidate_link.created',
    jsonb_build_object('expires_at', v_expires, 'by', v_staff.display_name));
  return v_expires;
end;
$$;

create or replace function public.revoke_candidate_links(p_session uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff record := public.require_session_staff(p_session);
  v_count integer;
begin
  update public.candidate_links set revoked_at = now()
  where session_id = p_session and revoked_at is null and accepted_at is null;
  get diagnostics v_count = row_count;
  if v_count > 0 then
    perform public.append_session_event(p_session, v_staff.participant_id, v_staff.actor_role, 'candidate_links.revoked',
      jsonb_build_object('count', v_count, 'by', v_staff.display_name));
  end if;
  return v_count;
end;
$$;

-- What a candidate link points to, for the join page. Works before sign-in, so it
-- reveals only the company, the candidate's name and whether the link works.
create or replace function public.candidate_link_preview(p_token_hash text)
returns table (
  session_id uuid, org_name text, candidate_name text, scheduled_at timestamptz,
  session_status text, link_state text, my_role text, is_staff boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_link public.candidate_links;
  v_session public.interview_sessions;
begin
  select * into v_link from public.candidate_links where token_hash = p_token_hash;
  if not found then return; end if;
  select * into v_session from public.interview_sessions where id = v_link.session_id;

  session_id := v_session.id;
  org_name := (select name from public.organizations where id = v_session.org_id);
  candidate_name := (select full_name from public.candidates where id = v_session.candidate_id);
  scheduled_at := v_session.scheduled_at;
  session_status := v_session.status;
  my_role := public.session_role(v_session.id);
  is_staff := public.is_org_member(v_session.org_id);
  link_state := case
    when v_session.status in ('completed', 'cancelled') then 'closed'
    when v_link.accepted_at is not null then 'used'
    when v_link.revoked_at is not null then 'revoked'
    when v_link.expires_at <= now() then 'expired'
    else 'valid'
  end;
  return next;
end;
$$;

-- The candidate joins. If they already joined from another device, the new link
-- moves their seat to this browser.
create or replace function public.accept_candidate_link(p_token_hash text, p_display_name text, p_consent boolean)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_link public.candidate_links;
  v_session public.interview_sessions;
  v_part public.session_participants;
  v_name text := btrim(coalesce(p_display_name, ''));
  v_rejoined boolean := false;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  select * into v_link from public.candidate_links where token_hash = p_token_hash for update;
  if not found then
    raise exception 'This link isn''t valid' using errcode = 'P0002';
  end if;
  select * into v_session from public.interview_sessions where id = v_link.session_id for update;

  if public.session_role(v_session.id) = 'candidate' then
    return v_session.id; -- opened the link twice
  end if;
  if public.is_org_member(v_session.org_id) then
    raise exception 'You''re signed in to this company''s workspace. Open the link in a private window, or send it to the candidate'
      using errcode = '22023';
  end if;
  if exists (select 1 from public.session_participants where session_id = v_session.id and user_id = v_uid) then
    raise exception 'You''re already part of this interview' using errcode = '22023';
  end if;
  if v_session.status not in ('lobby', 'in_progress') then
    raise exception 'This interview has ended' using errcode = '22023';
  end if;
  if v_link.accepted_at is not null or v_link.revoked_at is not null or v_link.expires_at <= now() then
    raise exception 'This link has expired or was already used. Ask your interviewer for a new one' using errcode = '22023';
  end if;
  if char_length(v_name) not between 1 and 80 then
    raise exception 'Enter your name (up to 80 characters)' using errcode = '22023';
  end if;
  if p_consent is not true then
    raise exception 'Recording consent is required' using errcode = '22023';
  end if;

  select * into v_part from public.session_participants where session_id = v_session.id and role = 'candidate';
  if found then
    update public.session_participants
    set user_id = v_uid, display_name = v_name, consented_at = now(), joined_at = now()
    where id = v_part.id
    returning * into v_part;
    v_rejoined := true;
  else
    insert into public.session_participants (session_id, user_id, role, display_name, consented_at, joined_at)
    values (v_session.id, v_uid, 'candidate', v_name, now(), now())
    returning * into v_part;
  end if;

  update public.candidate_links set accepted_at = now(), accepted_by = v_part.id where id = v_link.id;

  perform public.append_session_event(v_session.id, v_part.id, 'candidate', 'participant.joined',
    jsonb_build_object('role', 'candidate', 'display_name', v_name, 'rejoined', v_rejoined));
  perform public.append_session_event(v_session.id, v_part.id, 'candidate', 'consent.given',
    jsonb_build_object('consent_version', 2));
  return v_session.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Lifecycle: start, change phase, end. Interviewers run the clock.
-- ---------------------------------------------------------------------------

create or replace function public.start_session(p_session uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.session_participants := public.require_participant(p_session);
  v_session public.interview_sessions;
  v_first text := (public.interview_phases())[1];
begin
  select * into v_session from public.interview_sessions where id = p_session for update;
  if v_session.status <> 'lobby' then
    raise exception 'This interview has already started' using errcode = '22023';
  end if;
  if v_me.role <> 'interviewer' then
    raise exception 'Only the interviewer can start the interview' using errcode = '42501';
  end if;
  if not exists (select 1 from public.session_participants
                 where session_id = p_session and role = 'candidate' and joined_at is not null) then
    raise exception 'The candidate hasn''t joined yet. Send them their link' using errcode = '22023';
  end if;

  update public.interview_sessions
  set status = 'in_progress', started_at = now(), phase = v_first, phase_started_at = now()
  where id = p_session;

  perform public.append_session_event(p_session, v_me.id, v_me.role, 'session.started', '{}'::jsonb);
  perform public.append_session_event(p_session, v_me.id, v_me.role, 'phase.changed',
    jsonb_build_object('from', null, 'to', v_first, 'elapsed_ms', 0));
end;
$$;

create or replace function public.change_session_phase(p_session uuid, p_phase text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.session_participants := public.require_participant(p_session);
  v_session public.interview_sessions;
begin
  select * into v_session from public.interview_sessions where id = p_session for update;
  if v_session.status <> 'in_progress' then
    raise exception 'The interview isn''t running' using errcode = '22023';
  end if;
  if v_me.role <> 'interviewer' then
    raise exception 'Only the interviewer controls the phases' using errcode = '42501';
  end if;
  if not (p_phase = any (public.interview_phases())) then
    raise exception 'Unknown phase' using errcode = '22023';
  end if;
  if p_phase = v_session.phase then
    return;
  end if;

  update public.interview_sessions set phase = p_phase, phase_started_at = now() where id = p_session;
  perform public.append_session_event(p_session, v_me.id, v_me.role, 'phase.changed', jsonb_build_object(
    'from', v_session.phase, 'to', p_phase,
    'elapsed_ms', floor(extract(epoch from (now() - v_session.phase_started_at)) * 1000)::bigint
  ));
end;
$$;

-- Lobby → cancelled (the hiring team only). Running → completed: 'completed' when
-- an interviewer ends it, 'ended_early' when the candidate leaves.
create or replace function public.end_session(p_session uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.interview_sessions;
  v_pid uuid := public.session_participant_id(p_session);
  v_role text := public.session_role(p_session);
  v_by text;
  v_reason text;
begin
  if (select auth.uid()) is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  select * into v_session from public.interview_sessions where id = p_session for update;
  if not found or not public.can_view_session(p_session) then
    raise exception 'Session not found' using errcode = 'P0002';
  end if;
  if v_session.status in ('completed', 'cancelled') then
    return v_session.end_reason; -- already ended: idempotent
  end if;

  if v_role is null then
    v_role := 'member'; -- workspace member who isn't in the room
    select display_name into v_by from public.org_members where user_id = (select auth.uid());
  end if;

  if v_session.status = 'lobby' then
    if v_role = 'candidate' then
      raise exception 'Only the hiring team can cancel an interview' using errcode = '42501';
    end if;
    v_reason := 'cancelled';
    update public.interview_sessions set status = 'cancelled', ended_at = now(), end_reason = v_reason
    where id = p_session;
  else
    if v_role = 'member' then
      raise exception 'Join the interview to end it' using errcode = '42501';
    end if;
    v_reason := case when v_role = 'interviewer' then 'completed' else 'ended_early' end;
    update public.interview_sessions set status = 'completed', ended_at = now(), end_reason = v_reason
    where id = p_session;
  end if;

  update public.candidate_links set revoked_at = now()
  where session_id = p_session and revoked_at is null and accepted_at is null;

  perform public.append_session_event(p_session, v_pid, v_role, 'session.ended', jsonb_build_object(
    'reason', v_reason,
    'final_phase', v_session.phase,
    'by', v_by,
    'duration_ms', case when v_session.started_at is not null
      then floor(extract(epoch from (now() - v_session.started_at)) * 1000)::bigint end
  ));
  return v_reason;
end;
$$;

-- ---------------------------------------------------------------------------
-- record_event(): participant actions during a session
--
--   type                       who            when                 visibility
--   chat.message               anyone         lobby, in_progress   all
--   probe.asked                interviewer    in_progress          all
--   notes.updated              candidate      in_progress          all
--   board.updated              anyone         in_progress          all
--   interviewer_note.updated   interviewer    lobby → completed    interviewers
-- ---------------------------------------------------------------------------

create or replace function public.record_event(
  p_session uuid,
  p_type text,
  p_payload jsonb,
  p_client_ts timestamptz default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.session_participants := public.require_participant(p_session);
  v_session public.interview_sessions;
  v_text text;
  v_elements jsonb;
  v_merged jsonb;
  v_event public.session_events;
begin
  select * into v_session from public.interview_sessions where id = p_session for update;
  if jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception 'Payload must be an object' using errcode = '22023';
  end if;

  if p_type = 'interviewer_note.updated' then
    if v_me.role <> 'interviewer' then
      raise exception 'Only interviewers have private notes' using errcode = '42501';
    end if;
    if v_session.status = 'cancelled' then
      raise exception 'This interview was cancelled' using errcode = '22023';
    end if;
    v_text := coalesce(p_payload ->> 'text', '');
    if char_length(v_text) > 20000 then
      raise exception 'Notes are limited to 20,000 characters' using errcode = '22001';
    end if;
    if exists (select 1 from public.session_interviewer_notes
               where session_id = p_session and participant_id = v_me.id and body = v_text) then
      return null;
    end if;
    insert into public.session_interviewer_notes (session_id, participant_id, body)
    values (p_session, v_me.id, v_text)
    on conflict (session_id, participant_id) do update set body = excluded.body, updated_at = now();
    v_event := public.append_session_event(p_session, v_me.id, v_me.role, p_type,
      jsonb_build_object('text', v_text), 'interviewers', p_client_ts);
    return v_event.seq;
  end if;

  if p_type = 'chat.message' then
    if v_session.status not in ('lobby', 'in_progress') then
      raise exception 'This interview has ended' using errcode = '22023';
    end if;
    v_text := btrim(coalesce(p_payload ->> 'text', ''));
    if char_length(v_text) not between 1 and 2000 then
      raise exception 'Messages must be 1–2,000 characters' using errcode = '22001';
    end if;
    v_event := public.append_session_event(p_session, v_me.id, v_me.role, p_type,
      jsonb_build_object('text', v_text), 'all', p_client_ts);
    return v_event.seq;
  end if;

  if v_session.status <> 'in_progress' then
    raise exception 'The interview isn''t running' using errcode = '22023';
  end if;

  if p_type = 'probe.asked' then
    if v_me.role <> 'interviewer' then
      raise exception 'Only interviewers ask probe questions' using errcode = '42501';
    end if;
    v_text := btrim(coalesce(p_payload ->> 'text', ''));
    if char_length(v_text) not between 1 and 1000 then
      raise exception 'Questions must be 1–1,000 characters' using errcode = '22001';
    end if;
    v_event := public.append_session_event(p_session, v_me.id, v_me.role, p_type,
      jsonb_build_object('text', v_text), 'all', p_client_ts);
    return v_event.seq;
  end if;

  if p_type = 'notes.updated' then
    if v_me.role <> 'candidate' then
      raise exception 'Only the candidate edits the notes' using errcode = '42501';
    end if;
    v_text := coalesce(p_payload ->> 'text', '');
    if char_length(v_text) > 20000 then
      raise exception 'Notes are limited to 20,000 characters' using errcode = '22001';
    end if;
    if v_text = v_session.notes then
      return null;
    end if;
    update public.interview_sessions set notes = v_text where id = p_session;
    v_event := public.append_session_event(p_session, v_me.id, v_me.role, p_type,
      jsonb_build_object('text', v_text), 'all', p_client_ts);
    return v_event.seq;
  end if;

  if p_type = 'board.updated' then
    v_elements := p_payload -> 'elements';
    if jsonb_typeof(v_elements) is distinct from 'array'
       or jsonb_array_length(v_elements) not between 1 and 500 then
      raise exception 'A board update carries 1–500 elements' using errcode = '22023';
    end if;
    if exists (
      select 1 from jsonb_array_elements(v_elements) as e(el)
      where jsonb_typeof(el) <> 'object'
         or jsonb_typeof(el -> 'id') is distinct from 'string'
         or char_length(el ->> 'id') not between 1 and 64
         or jsonb_typeof(el -> 'version') is distinct from 'number'
         or jsonb_typeof(el -> 'versionNonce') is distinct from 'number'
         or (el ->> 'version')::numeric < 1
         or (el ->> 'version')::numeric <> trunc((el ->> 'version')::numeric)
         or el ->> 'type' = 'image'
    ) then
      raise exception 'Invalid board element' using errcode = '22023';
    end if;
    v_merged := public.merge_board(v_session.board, v_elements);
    if jsonb_array_length(v_merged) > 3000 then
      raise exception 'The board is limited to 3,000 elements' using errcode = '54000';
    end if;
    if v_merged = v_session.board then
      return null;
    end if;
    update public.interview_sessions set board = v_merged where id = p_session;
    v_event := public.append_session_event(p_session, v_me.id, v_me.role, p_type,
      jsonb_build_object('elements', v_elements), 'all', p_client_ts);
    return v_event.seq;
  end if;

  raise exception 'Unknown or system-only event type: %', p_type using errcode = '22023';
end;
$$;

-- ---------------------------------------------------------------------------
-- Scorecards. scores: {"<aspect>": {"score": 1-4 | null, "evidence": "…"}}
-- ---------------------------------------------------------------------------

create or replace function public.scores_valid(p_scores jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p_scores) = 'object' and not exists (
    select 1 from jsonb_each(p_scores) as s(k, v)
    where not (k = any (public.evaluation_aspects()))
       or jsonb_typeof(v) <> 'object'
       or (v ? 'score' and jsonb_typeof(v -> 'score') not in ('number', 'null'))
       or (jsonb_typeof(v -> 'score') = 'number' and (v ->> 'score') not in ('1', '2', '3', '4'))
       or (v ? 'evidence' and jsonb_typeof(v -> 'evidence') <> 'string')
       or char_length(coalesce(v ->> 'evidence', '')) > 2000
  )
$$;

create or replace function public.save_evaluation(
  p_session uuid,
  p_scores jsonb,
  p_recommendation text,
  p_summary text,
  p_submit boolean
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.session_participants := public.require_participant(p_session);
  v_session public.interview_sessions;
  v_existing public.session_evaluations;
  v_scores jsonb := coalesce(p_scores, '{}'::jsonb);
  v_summary text := btrim(coalesce(p_summary, ''));
  v_submitted timestamptz;
  v_id uuid;
begin
  if v_me.role <> 'interviewer' then
    raise exception 'Only interviewers write scorecards' using errcode = '42501';
  end if;
  select * into v_session from public.interview_sessions where id = p_session;
  if v_session.status not in ('in_progress', 'completed') then
    raise exception 'Scorecards open once the interview starts' using errcode = '22023';
  end if;
  if p_submit and v_session.status <> 'completed' then
    raise exception 'You can submit once the interview has ended' using errcode = '22023';
  end if;

  select * into v_existing from public.session_evaluations where session_id = p_session and participant_id = v_me.id;
  if found and v_existing.submitted_at is not null then
    raise exception 'You already submitted this scorecard' using errcode = '42501';
  end if;
  if not public.scores_valid(v_scores) then
    raise exception 'Invalid scores' using errcode = '22023';
  end if;
  if char_length(v_summary) > 5000 then
    raise exception 'The summary is limited to 5,000 characters' using errcode = '22001';
  end if;
  if p_submit then
    if not exists (select 1 from jsonb_each(v_scores) as s(k, v) where jsonb_typeof(v -> 'score') = 'number') then
      raise exception 'Score at least one aspect before submitting' using errcode = '22023';
    end if;
    if p_recommendation is null or char_length(v_summary) = 0 then
      raise exception 'A scorecard needs a recommendation and a summary' using errcode = '22023';
    end if;
  end if;

  v_submitted := case when p_submit then now() end;
  insert into public.session_evaluations (session_id, participant_id, scores, recommendation, summary, submitted_at)
  values (p_session, v_me.id, v_scores, p_recommendation, v_summary, v_submitted)
  on conflict (session_id, participant_id) do update
    set scores = excluded.scores, recommendation = excluded.recommendation,
        summary = excluded.summary, submitted_at = excluded.submitted_at
  returning id into v_id;

  if p_submit then
    perform public.append_session_event(p_session, v_me.id, v_me.role, 'evaluation.submitted', jsonb_build_object(
      'evaluation_id', v_id,
      'content_hash', encode(sha256(convert_to(
        jsonb_build_object('scores', v_scores, 'recommendation', p_recommendation, 'summary', v_summary)::text,
        'UTF8')), 'hex')
    ), 'interviewers');
  end if;
  return v_submitted;
end;
$$;

-- ---------------------------------------------------------------------------
-- AI assessment (server only: executable by service_role, not by clients, so a
-- workspace member can't write a result and pass it off as the AI's).
-- ---------------------------------------------------------------------------

create or replace function public.begin_ai_assessment(p_session uuid, p_requested_by uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.interview_sessions;
  v_existing public.session_ai_assessments;
begin
  select * into v_session from public.interview_sessions where id = p_session for update;
  if not found then
    raise exception 'Session not found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.org_members where org_id = v_session.org_id and user_id = p_requested_by) then
    raise exception 'Only the hiring team can request an AI assessment' using errcode = '42501';
  end if;
  if v_session.status <> 'completed' then
    raise exception 'The AI assessment is available once the interview has ended' using errcode = '22023';
  end if;
  select * into v_existing from public.session_ai_assessments where session_id = p_session;
  if found and v_existing.status = 'completed' then
    raise exception 'This interview already has an AI assessment' using errcode = '22023';
  end if;
  if found and v_existing.status = 'running' and v_existing.requested_at > now() - interval '10 minutes' then
    raise exception 'The AI assessment is already being generated' using errcode = '22023';
  end if;

  insert into public.session_ai_assessments (session_id, status, requested_by, requested_at)
  values (p_session, 'running', p_requested_by, now())
  on conflict (session_id) do update
    set status = 'running', requested_by = excluded.requested_by, requested_at = excluded.requested_at,
        error = null, scores = '{}', recommendation = null, summary = '', strengths = '{}', concerns = '{}',
        model = null, completed_at = null;
end;
$$;

create or replace function public.complete_ai_assessment(
  p_session uuid,
  p_model text,
  p_scores jsonb,
  p_recommendation text,
  p_summary text,
  p_strengths text[],
  p_concerns text[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.scores_valid(coalesce(p_scores, '{}'::jsonb)) then
    raise exception 'Invalid scores' using errcode = '22023';
  end if;
  update public.session_ai_assessments
  set status = 'completed', model = p_model, scores = p_scores, recommendation = p_recommendation,
      summary = left(btrim(coalesce(p_summary, '')), 5000),
      strengths = coalesce(p_strengths, '{}'), concerns = coalesce(p_concerns, '{}'),
      completed_at = now(), error = null
  where session_id = p_session and status = 'running';
  if not found then
    raise exception 'No AI assessment is running for this interview' using errcode = '22023';
  end if;

  perform public.append_session_event(p_session, null, 'system', 'ai_assessment.completed', jsonb_build_object(
    'model', p_model,
    'content_hash', encode(sha256(convert_to(
      jsonb_build_object('scores', p_scores, 'recommendation', p_recommendation, 'summary', p_summary,
                         'strengths', to_jsonb(p_strengths), 'concerns', to_jsonb(p_concerns))::text,
      'UTF8')), 'hex')
  ), 'interviewers');
end;
$$;

create or replace function public.fail_ai_assessment(p_session uuid, p_error text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.session_ai_assessments
  set status = 'failed', error = left(coalesce(p_error, 'Unknown error'), 500)
  where session_id = p_session and status = 'running'
$$;

-- ---------------------------------------------------------------------------
-- verify_session_log(): recompute the hash chain. Reveals only pass/fail.
-- ---------------------------------------------------------------------------

create or replace function public.verify_session_log(p_session uuid)
returns table (ok boolean, event_count bigint, first_bad_seq bigint, head_hash text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_prev text := public.session_genesis_hash(p_session);
  v_expected_seq bigint := 1;
  e public.session_events;
begin
  if not public.can_view_session(p_session) then
    raise exception 'You are not part of this session' using errcode = '42501';
  end if;
  ok := true;
  event_count := 0;
  for e in select * from public.session_events where session_id = p_session order by seq loop
    event_count := event_count + 1;
    if e.seq <> v_expected_seq
       or e.prev_hash <> v_prev
       or e.hash <> public.session_event_hash(e.prev_hash, e.session_id, e.seq, e.participant_id, e.type,
                                              e.visibility, e.phase, e.payload, e.created_at) then
      ok := false;
      first_bad_seq := e.seq;
      exit;
    end if;
    v_prev := e.hash;
    v_expected_seq := v_expected_seq + 1;
  end loop;
  if ok and v_prev <> (select last_hash from public.interview_sessions where id = p_session) then
    ok := false;
    first_bad_seq := v_expected_seq;
  end if;
  head_hash := v_prev;
  return next;
end;
$$;

-- ---------------------------------------------------------------------------
-- Accounts
-- ---------------------------------------------------------------------------

-- Deleting the last person in a workspace deletes the workspace with it (its
-- candidates and interviews). The last admin of a team has to hand over first.
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_member public.org_members;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  select * into v_member from public.org_members where user_id = v_uid;
  if found then
    if (select count(*) from public.org_members where org_id = v_member.org_id) = 1 then
      delete from public.organizations where id = v_member.org_id;
    elsif v_member.role = 'admin'
      and (select count(*) from public.org_members where org_id = v_member.org_id and role = 'admin') = 1 then
      raise exception 'You''re the only admin. Make someone else an admin first' using errcode = '22023';
    end if;
  end if;
  delete from auth.users where id = v_uid;
end;
$$;

create or replace function public.sync_user_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.org_members set email = new.email where user_id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row
  when (old.email is distinct from new.email)
  execute function public.sync_user_email();

-- ---------------------------------------------------------------------------
-- Row-level security and grants
-- ---------------------------------------------------------------------------

alter table public.organizations enable row level security;
alter table public.org_members enable row level security;
alter table public.org_invites enable row level security;
alter table public.candidates enable row level security;
alter table public.interview_sessions enable row level security;
alter table public.session_participants enable row level security;
alter table public.candidate_links enable row level security;
alter table public.session_events enable row level security;
alter table public.session_interviewer_notes enable row level security;
alter table public.session_evaluations enable row level security;
alter table public.session_ai_assessments enable row level security;

revoke all on public.organizations, public.org_members, public.org_invites, public.candidates,
  public.interview_sessions, public.session_participants, public.candidate_links, public.session_events,
  public.session_interviewer_notes, public.session_evaluations, public.session_ai_assessments
  from anon, authenticated;

-- Workspace
grant select on public.organizations, public.org_members to authenticated;
grant update (name) on public.organizations to authenticated;
-- token_hash is left out on purpose.
grant select (id, org_id, email, role, created_at, expires_at, accepted_at, revoked_at) on public.org_invites to authenticated;

create policy "Members read their workspace"
  on public.organizations for select to authenticated
  using (public.is_org_member(id));

create policy "Candidates see who is interviewing them"
  on public.organizations for select to authenticated
  using (public.is_org_candidate(id));

create policy "Admins rename their workspace"
  on public.organizations for update to authenticated
  using (public.is_org_admin(id))
  with check (public.is_org_admin(id));

create policy "Members see their teammates"
  on public.org_members for select to authenticated
  using (public.is_org_member(org_id));

create policy "Admins see pending invites"
  on public.org_invites for select to authenticated
  using (public.is_org_admin(org_id));

-- Candidates: plain table writes, scoped by RLS to the caller's workspace.
grant select on public.candidates to authenticated;
grant insert (org_id, full_name, email, role_title, seniority, notes) on public.candidates to authenticated;
grant update (full_name, email, role_title, seniority, notes) on public.candidates to authenticated;
grant delete on public.candidates to authenticated;

create policy "Members read their candidates"
  on public.candidates for select to authenticated
  using (public.is_org_member(org_id));

create policy "Members add candidates"
  on public.candidates for insert to authenticated
  with check (public.is_org_member(org_id));

create policy "Members edit candidates"
  on public.candidates for update to authenticated
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));

create policy "Admins delete candidates"
  on public.candidates for delete to authenticated
  using (public.is_org_admin(org_id));

-- Sessions: read-only; writes go through the functions above.
grant select on public.interview_sessions, public.session_participants, public.session_events,
  public.session_interviewer_notes, public.session_evaluations, public.session_ai_assessments to authenticated;

create policy "The room and the hiring team read sessions"
  on public.interview_sessions for select to authenticated
  using (public.can_view_session(id));

create policy "The room and the hiring team see participants"
  on public.session_participants for select to authenticated
  using (public.can_view_session(session_id));

create policy "Events are visible per audience"
  on public.session_events for select to authenticated
  using (
    case visibility
      when 'all' then public.can_view_session(session_id)
      else public.session_role(session_id) = 'interviewer' or public.session_org_member(session_id)
    end
  );

create policy "Interviewers read their own private notes"
  on public.session_interviewer_notes for select to authenticated
  using (participant_id = public.session_participant_id(session_id));

create policy "Scorecards are released per ADR 0006"
  on public.session_evaluations for select to authenticated
  using (public.can_read_evaluation(session_id, participant_id, submitted_at));

create policy "The AI assessment is released like scorecards"
  on public.session_ai_assessments for select to authenticated
  using (public.review_unlocked(session_id));

-- candidate_links: no client access at all.

-- Realtime authorisation (private channels). See ADR 0002.
create policy "Session participants can receive session broadcasts"
  on realtime.messages for select to authenticated
  using (
    realtime.messages.extension in ('broadcast', 'presence')
    and public.realtime_topic_allowed((select realtime.topic()), false)
  );

create policy "Session participants can send live board and presence updates"
  on realtime.messages for insert to authenticated
  with check (
    realtime.messages.extension in ('broadcast', 'presence')
    and public.realtime_topic_allowed((select realtime.topic()), true)
  );

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------

revoke all on function
  public.evaluation_aspects(),
  public.email_valid(text),
  public.is_anonymous_user(),
  public.my_org_id(),
  public.is_org_member(uuid),
  public.is_org_admin(uuid),
  public.is_org_candidate(uuid),
  public.require_member(),
  public.create_organization(text, text),
  public.update_my_display_name(text),
  public.create_org_invite(text, text, text),
  public.revoke_org_invite(uuid),
  public.org_invite_preview(text),
  public.accept_org_invite(text, text),
  public.set_org_member_role(uuid, text),
  public.remove_org_member(uuid),
  public.anonymize_participant(),
  public.session_role(uuid),
  public.session_participant_id(uuid),
  public.session_org_member(uuid),
  public.can_view_session(uuid),
  public.review_unlocked(uuid),
  public.can_read_evaluation(uuid, uuid, timestamptz),
  public.realtime_topic_allowed(text, boolean),
  public.append_session_event(uuid, uuid, text, text, jsonb, text, timestamptz),
  public.require_participant(uuid),
  public.create_session(uuid, text, integer, text, jsonb, jsonb, uuid[], timestamptz),
  public.join_session(uuid, boolean),
  public.require_session_staff(uuid),
  public.create_candidate_link(uuid, text, integer),
  public.revoke_candidate_links(uuid),
  public.candidate_link_preview(text),
  public.accept_candidate_link(text, text, boolean),
  public.start_session(uuid),
  public.change_session_phase(uuid, text),
  public.end_session(uuid),
  public.record_event(uuid, text, jsonb, timestamptz),
  public.scores_valid(jsonb),
  public.save_evaluation(uuid, jsonb, text, text, boolean),
  public.begin_ai_assessment(uuid, uuid),
  public.complete_ai_assessment(uuid, text, jsonb, text, text, text[], text[]),
  public.fail_ai_assessment(uuid, text),
  public.verify_session_log(uuid),
  public.delete_my_account(),
  public.sync_user_email()
from public, anon, authenticated;

-- Used inside RLS policies and CHECK constraints, so the querying role needs execute.
grant execute on function
  public.interview_phases(),
  public.evaluation_aspects(),
  public.email_valid(text),
  public.is_org_member(uuid),
  public.is_org_admin(uuid),
  public.is_org_candidate(uuid),
  public.my_org_id(),
  public.session_role(uuid),
  public.session_participant_id(uuid),
  public.session_org_member(uuid),
  public.can_view_session(uuid),
  public.review_unlocked(uuid),
  public.can_read_evaluation(uuid, uuid, timestamptz),
  public.realtime_topic_allowed(text, boolean)
to authenticated;

-- The client-facing API.
grant execute on function
  public.create_organization(text, text),
  public.update_my_display_name(text),
  public.create_org_invite(text, text, text),
  public.revoke_org_invite(uuid),
  public.org_invite_preview(text),
  public.accept_org_invite(text, text),
  public.set_org_member_role(uuid, text),
  public.remove_org_member(uuid),
  public.create_session(uuid, text, integer, text, jsonb, jsonb, uuid[], timestamptz),
  public.join_session(uuid, boolean),
  public.create_candidate_link(uuid, text, integer),
  public.revoke_candidate_links(uuid),
  public.accept_candidate_link(text, text, boolean),
  public.start_session(uuid),
  public.change_session_phase(uuid, text),
  public.end_session(uuid),
  public.record_event(uuid, text, jsonb, timestamptz),
  public.save_evaluation(uuid, jsonb, text, text, boolean),
  public.verify_session_log(uuid),
  public.delete_my_account()
to authenticated;

-- The candidate join page previews the link before anyone is signed in.
grant execute on function public.candidate_link_preview(text) to anon, authenticated;

-- Server only (SUPABASE_SECRET_KEY).
grant execute on function
  public.begin_ai_assessment(uuid, uuid),
  public.complete_ai_assessment(uuid, text, jsonb, text, text, text[], text[]),
  public.fail_ai_assessment(uuid, text)
to service_role;
