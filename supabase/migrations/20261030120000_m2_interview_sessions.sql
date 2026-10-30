-- Probewise · Phase 1 · Milestone 2: collaborative interview sessions
-- Sessions, participants, invites, the append-only audit log, interviewer notes,
-- evaluations, row-level security and Realtime authorisation.
--
-- Design: docs/architecture/interview-sessions.md · Decisions: docs/adr/0001–0006
--
--   * Clients never write these tables directly. Every write goes through a
--     security-definer function that checks the caller's role and the session state.
--   * Every recorded action is a row in session_events with a gap-free per-session
--     seq and a SHA-256 hash chain (tamper-evident). Rows can't be updated.
--   * Events are broadcast to Realtime from inside the same transaction, so anything
--     a participant sees live is already in the log.

-- ---------------------------------------------------------------------------
-- Vocabularies (keep in sync with src/lib/interview/*.ts; a test checks this)
-- ---------------------------------------------------------------------------

create or replace function public.interview_phases()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['requirements', 'estimation', 'api_data_model', 'high_level_design', 'deep_dive', 'tradeoffs']::text[]
$$;

-- A phase plan is {"<phase>": minutes, …} with every phase present and 1–60 minutes each.
create or replace function public.phase_plan_valid(plan jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(plan) = 'object'
    and (select array_agg(k order by k) from jsonb_object_keys(plan) as k)
      = (select array_agg(p order by p) from unnest(public.interview_phases()) as p)
    and (select bool_and(jsonb_typeof(v) = 'number' and (v::text)::numeric between 1 and 60
                         and (v::text)::numeric = trunc((v::text)::numeric))
         from jsonb_each(plan) as e(k, v))
$$;

-- ---------------------------------------------------------------------------
-- interview_sessions
-- ---------------------------------------------------------------------------

create table public.interview_sessions (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references auth.users (id) on delete cascade,
  mode text not null check (mode in ('solo', 'peer')),
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

create index interview_sessions_candidate_idx on public.interview_sessions (candidate_id, created_at desc);

create trigger interview_sessions_updated_at
  before update on public.interview_sessions
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- session_participants
-- Events reference participants (not auth users), so the log stays verifiable
-- after someone deletes their account (ADR 0005).
-- ---------------------------------------------------------------------------

create table public.session_participants (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.interview_sessions (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  role text not null check (role in ('candidate', 'interviewer')),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 80),
  consented_at timestamptz not null,
  joined_at timestamptz not null default now(),
  unique (session_id, user_id)
);

create unique index session_participants_one_candidate on public.session_participants (session_id)
  where role = 'candidate';
create index session_participants_user_idx on public.session_participants (user_id);

-- When an account is deleted, drop the name along with the link to the user.
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
-- session_invites: one-time links for interviewers. Only the SHA-256 of the
-- token is stored; the token itself is shown once to the candidate.
-- ---------------------------------------------------------------------------

create table public.session_invites (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.interview_sessions (id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid not null references public.session_participants (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  accepted_at timestamptz,
  accepted_by uuid references public.session_participants (id) on delete cascade,
  check (expires_at > created_at),
  check ((accepted_at is null) = (accepted_by is null))
);

create index session_invites_session_idx on public.session_invites (session_id);

-- ---------------------------------------------------------------------------
-- session_events: the append-only, hash-chained audit log (ADR 0001)
-- ---------------------------------------------------------------------------

create table public.session_events (
  session_id uuid not null references public.interview_sessions (id) on delete cascade,
  seq bigint not null check (seq >= 1),
  participant_id uuid references public.session_participants (id),
  actor_role text not null check (actor_role in ('candidate', 'interviewer', 'system')),
  -- keep in sync with EVENT_TYPES in src/lib/interview/events.ts
  type text not null check (type in (
    'session.created', 'participant.joined', 'consent.given', 'invite.created', 'invites.revoked',
    'session.started', 'phase.changed', 'session.ended',
    'chat.message', 'probe.asked', 'notes.updated', 'board.updated',
    'interviewer_note.updated', 'evaluation.submitted'
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

create or replace function public.reject_event_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'session_events is append-only' using errcode = '42501';
end;
$$;

create trigger session_events_no_update
  before update on public.session_events
  for each row execute function public.reject_event_mutation();

create trigger session_events_no_truncate
  before truncate on public.session_events
  for each statement execute function public.reject_event_mutation();

-- sha256 over a canonical, pipe-joined encoding. jsonb::text is canonical
-- (keys sorted, whitespace normalised), so the same payload always hashes the same.
create or replace function public.session_event_hash(
  p_prev text, p_session uuid, p_seq bigint, p_participant uuid, p_type text,
  p_visibility text, p_phase text, p_payload jsonb, p_created_at timestamptz
)
returns text
language sql
stable
set search_path = ''
as $$
  select encode(sha256(convert_to(concat_ws('|',
    p_prev, p_session::text, p_seq::text, coalesce(p_participant::text, '-'), p_type, p_visibility,
    coalesce(p_phase, '-'), p_payload::text,
    to_char(p_created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  ), 'UTF8')), 'hex')
$$;

create or replace function public.session_genesis_hash(p_session uuid)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to('probewise.session:' || p_session::text, 'UTF8')), 'hex')
$$;

-- ---------------------------------------------------------------------------
-- session_interviewer_notes: each interviewer's private notes (never visible to
-- the candidate).
-- ---------------------------------------------------------------------------

create table public.session_interviewer_notes (
  session_id uuid not null references public.interview_sessions (id) on delete cascade,
  participant_id uuid not null references public.session_participants (id) on delete cascade,
  body text not null default '' check (char_length(body) <= 20000),
  updated_at timestamptz not null default now(),
  primary key (session_id, participant_id)
);

-- ---------------------------------------------------------------------------
-- session_evaluations: interviewer scorecards and the candidate's
-- self-assessment (ADR 0006). Immutable once submitted.
-- ---------------------------------------------------------------------------

create table public.session_evaluations (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.interview_sessions (id) on delete cascade,
  participant_id uuid not null references public.session_participants (id) on delete cascade,
  kind text not null check (kind in ('scorecard', 'self')),
  -- {"<phase>": {"score": 1-4 | null, "evidence": "…"}}
  scores jsonb not null default '{}' check (jsonb_typeof(scores) = 'object'),
  -- keep in sync with RECOMMENDATIONS in src/lib/interview/rubric.ts
  recommendation text check (recommendation in ('strong_no', 'no', 'yes', 'strong_yes')),
  summary text not null default '' check (char_length(summary) <= 5000),
  rubric_version smallint not null default 1,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, participant_id),
  check (kind = 'scorecard' or recommendation is null)
);

create or replace function public.reject_submitted_evaluation_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.submitted_at is not null then
    raise exception 'A submitted evaluation can''t be changed' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger session_evaluations_immutable
  before update on public.session_evaluations
  for each row execute function public.reject_submitted_evaluation_change();

-- ---------------------------------------------------------------------------
-- Access helpers (used by RLS policies and the functions below)
-- ---------------------------------------------------------------------------

-- The caller's role in a session, or null if they aren't a participant.
create or replace function public.session_role(p_session uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.session_participants
  where session_id = p_session and user_id = (select auth.uid())
$$;

create or replace function public.session_participant_id(p_session uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.session_participants
  where session_id = p_session and user_id = (select auth.uid())
$$;

-- Who controls the timer and phases: the candidate when practising solo,
-- the interviewers in a peer session.
create or replace function public.session_controller_role(p_mode text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_mode when 'solo' then 'candidate' else 'interviewer' end
$$;

-- Evaluation visibility (ADR 0006): your own always; the candidate sees submitted
-- scorecards; an interviewer sees others only after submitting their own.
create or replace function public.can_read_evaluation(p_session uuid, p_author uuid, p_submitted_at timestamptz)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me public.session_participants;
begin
  select * into v_me from public.session_participants
  where session_id = p_session and user_id = (select auth.uid());
  if not found then return false; end if;
  if p_author = v_me.id then return true; end if;
  if p_submitted_at is null then return false; end if;
  if v_me.role = 'candidate' then return true; end if;
  return exists (
    select 1 from public.session_evaluations
    where session_id = p_session and participant_id = v_me.id and submitted_at is not null
  );
end;
$$;

-- Realtime topics: 'session:<id>' (all participants) and 'session:<id>:interviewers'.
-- Clients may send (ephemeral board deltas, presence) only on the main topic while
-- the session is live; the interviewers topic is written by the database only.
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
-- Board merge (ADR 0003): per element id keep the highest version; ties go to the
-- lowest versionNonce. Same rule as mergeBoard() in src/lib/interview/board.ts.
-- Existing elements keep their position; new ones are appended.
-- ---------------------------------------------------------------------------

create or replace function public.merge_board(p_current jsonb, p_incoming jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  with all_els as (
    select el, ord from jsonb_array_elements(coalesce(p_current, '[]'::jsonb)) with ordinality as t(el, ord)
    union all
    select el, ord + 1000000 from jsonb_array_elements(coalesce(p_incoming, '[]'::jsonb)) with ordinality as t(el, ord)
  ),
  winners as (
    select distinct on (el ->> 'id') el ->> 'id' as id, el
    from all_els
    order by el ->> 'id', (el ->> 'version')::numeric desc, (el ->> 'versionNonce')::numeric asc, ord asc
  ),
  positions as (
    select el ->> 'id' as id, min(ord) as pos from all_els group by 1
  )
  select coalesce(jsonb_agg(w.el order by p.pos), '[]'::jsonb)
  from winners w join positions p using (id)
$$;

-- ---------------------------------------------------------------------------
-- append_session_event(): the only writer of session_events. Internal; not
-- executable by clients. Locks the session row, so seq and the hash chain are
-- serialised per session.
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
  -- Client clocks are informational only; ignore anything wildly off.
  v_event.client_ts := case
    when p_client_ts between now() - interval '1 day' and now() + interval '1 day' then p_client_ts
  end;
  -- Truncated to microseconds so the stored value re-hashes identically.
  v_event.created_at := date_trunc('microseconds', clock_timestamp());
  v_event.prev_hash := v_session.last_hash;
  v_event.hash := public.session_event_hash(
    v_event.prev_hash, v_event.session_id, v_event.seq, v_event.participant_id, v_event.type,
    v_event.visibility, v_event.phase, v_event.payload, v_event.created_at
  );

  insert into public.session_events values (v_event.*);
  update public.interview_sessions set last_seq = v_event.seq, last_hash = v_event.hash where id = p_session;

  -- Broadcast inside the transaction: if this rolls back, nothing was sent (ADR 0002).
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
    -- Recording matters more than live delivery; clients catch up from the log.
    raise warning 'realtime.send failed for session % seq %: %', p_session, v_event.seq, sqlerrm;
  end;

  return v_event;
end;
$$;

-- Shared guard: the caller's participant row, or an error.
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
  where session_id = p_session and user_id = (select auth.uid());
  if not found then
    raise exception 'You are not part of this session' using errcode = '42501';
  end if;
  return v_me;
end;
$$;

-- ---------------------------------------------------------------------------
-- create_session(): members start a session (solo or peer)
-- ---------------------------------------------------------------------------

create or replace function public.create_session(
  p_mode text,
  p_problem_slug text,
  p_problem_version integer,
  p_problem_title text,
  p_problem_snapshot jsonb,
  p_phase_plan jsonb,
  p_display_name text,
  p_consent boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_session uuid := gen_random_uuid();
  v_participant uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if not exists (select 1 from public.profiles where id = v_uid and onboarding_completed_at is not null) then
    raise exception 'Only members who have finished onboarding can start a session' using errcode = '42501';
  end if;
  if p_consent is not true then
    raise exception 'Recording consent is required' using errcode = '22023';
  end if;
  if (select count(*) from public.interview_sessions
      where candidate_id = v_uid and status in ('lobby', 'in_progress')) >= 3 then
    raise exception 'You already have 3 open sessions. Finish or cancel one first' using errcode = '54000';
  end if;

  insert into public.interview_sessions (
    id, candidate_id, mode, problem_slug, problem_version, problem_title, problem_snapshot, phase_plan, last_hash
  ) values (
    v_session, v_uid, p_mode, p_problem_slug, p_problem_version, btrim(p_problem_title), p_problem_snapshot,
    p_phase_plan, public.session_genesis_hash(v_session)
  );

  insert into public.session_participants (session_id, user_id, role, display_name, consented_at)
  values (v_session, v_uid, 'candidate', btrim(p_display_name), now())
  returning id into v_participant;

  perform public.append_session_event(v_session, v_participant, 'candidate', 'session.created', jsonb_build_object(
    'mode', p_mode, 'problem_slug', p_problem_slug, 'problem_version', p_problem_version,
    'problem_title', btrim(p_problem_title), 'phase_plan', p_phase_plan
  ));
  perform public.append_session_event(v_session, v_participant, 'candidate', 'participant.joined',
    jsonb_build_object('role', 'candidate', 'display_name', btrim(p_display_name)));
  perform public.append_session_event(v_session, v_participant, 'candidate', 'consent.given',
    jsonb_build_object('consent_version', 1));

  return v_session;
end;
$$;

-- ---------------------------------------------------------------------------
-- Invites
-- ---------------------------------------------------------------------------

create or replace function public.create_session_invite(p_session uuid, p_token_hash text, p_ttl_hours integer default 168)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.session_participants := public.require_participant(p_session);
  v_session public.interview_sessions;
  v_expires timestamptz := now() + make_interval(hours => least(greatest(coalesce(p_ttl_hours, 168), 1), 168));
begin
  select * into v_session from public.interview_sessions where id = p_session for update;
  if v_me.role <> 'candidate' then
    raise exception 'Only the candidate can invite interviewers' using errcode = '42501';
  end if;
  if v_session.mode <> 'peer' then
    raise exception 'Solo sessions don''t have interviewers' using errcode = '22023';
  end if;
  if v_session.status not in ('lobby', 'in_progress') then
    raise exception 'This session has ended' using errcode = '22023';
  end if;
  if (select count(*) from public.session_participants where session_id = p_session and role = 'interviewer') >= 2 then
    raise exception 'This session already has 2 interviewers' using errcode = '54000';
  end if;

  update public.session_invites set revoked_at = now()
  where session_id = p_session and revoked_at is null and accepted_at is null;

  insert into public.session_invites (session_id, token_hash, created_by, expires_at)
  values (p_session, p_token_hash, v_me.id, v_expires);

  perform public.append_session_event(p_session, v_me.id, v_me.role, 'invite.created',
    jsonb_build_object('expires_at', v_expires));
  return v_expires;
end;
$$;

create or replace function public.revoke_session_invites(p_session uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.session_participants := public.require_participant(p_session);
  v_count integer;
begin
  if v_me.role <> 'candidate' then
    raise exception 'Only the candidate can manage invites' using errcode = '42501';
  end if;
  update public.session_invites set revoked_at = now()
  where session_id = p_session and revoked_at is null and accepted_at is null;
  get diagnostics v_count = row_count;
  if v_count > 0 then
    perform public.append_session_event(p_session, v_me.id, v_me.role, 'invites.revoked',
      jsonb_build_object('count', v_count));
  end if;
  return v_count;
end;
$$;

-- What an invite link points to, for the join page. Reveals only the problem
-- title, the candidate's display name and whether the link still works.
create or replace function public.session_invite_preview(p_token_hash text)
returns table (
  session_id uuid, problem_title text, candidate_name text, mode text, session_status text,
  expires_at timestamptz, invite_state text, my_role text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_inv public.session_invites;
  v_session public.interview_sessions;
begin
  if (select auth.uid()) is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  select * into v_inv from public.session_invites where token_hash = p_token_hash;
  if not found then return; end if;
  select * into v_session from public.interview_sessions where id = v_inv.session_id;

  session_id := v_session.id;
  problem_title := v_session.problem_title;
  mode := v_session.mode;
  session_status := v_session.status;
  expires_at := v_inv.expires_at;
  select display_name into candidate_name from public.session_participants
  where public.session_participants.session_id = v_session.id and role = 'candidate';
  my_role := public.session_role(v_session.id);
  invite_state := case
    when v_session.status in ('completed', 'cancelled') then 'closed'
    when v_inv.accepted_at is not null then 'used'
    when v_inv.revoked_at is not null then 'revoked'
    when v_inv.expires_at <= now() then 'expired'
    else 'valid'
  end;
  return next;
end;
$$;

create or replace function public.accept_session_invite(p_token_hash text, p_display_name text, p_consent boolean)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_inv public.session_invites;
  v_session public.interview_sessions;
  v_existing text;
  v_participant uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  select * into v_inv from public.session_invites where token_hash = p_token_hash for update;
  if not found then
    raise exception 'This invite link isn''t valid' using errcode = 'P0002';
  end if;
  select * into v_session from public.interview_sessions where id = v_inv.session_id for update;

  v_existing := public.session_role(v_session.id);
  if v_existing = 'candidate' then
    raise exception 'You can''t interview yourself. Share the link with someone else' using errcode = '22023';
  end if;
  if v_existing = 'interviewer' then
    return v_session.id; -- already joined (e.g. clicked the link twice)
  end if;
  if v_session.status not in ('lobby', 'in_progress') then
    raise exception 'This session has ended' using errcode = '22023';
  end if;
  if v_inv.accepted_at is not null or v_inv.revoked_at is not null or v_inv.expires_at <= now() then
    raise exception 'This invite link has expired or was already used' using errcode = '22023';
  end if;
  if p_consent is not true then
    raise exception 'Recording consent is required' using errcode = '22023';
  end if;
  if (select count(*) from public.session_participants
      where session_id = v_session.id and role = 'interviewer') >= 2 then
    raise exception 'This session already has 2 interviewers' using errcode = '54000';
  end if;

  insert into public.session_participants (session_id, user_id, role, display_name, consented_at)
  values (v_session.id, v_uid, 'interviewer', btrim(p_display_name), now())
  returning id into v_participant;

  update public.session_invites set accepted_at = now(), accepted_by = v_participant where id = v_inv.id;

  perform public.append_session_event(v_session.id, v_participant, 'interviewer', 'participant.joined',
    jsonb_build_object('role', 'interviewer', 'display_name', btrim(p_display_name)));
  perform public.append_session_event(v_session.id, v_participant, 'interviewer', 'consent.given',
    jsonb_build_object('consent_version', 1));
  return v_session.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Lifecycle: start, change phase, end
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
    raise exception 'This session has already started' using errcode = '22023';
  end if;
  if v_me.role <> public.session_controller_role(v_session.mode) then
    raise exception 'Only the interviewer can start a peer session' using errcode = '42501';
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
    raise exception 'The session isn''t running' using errcode = '22023';
  end if;
  if v_me.role <> public.session_controller_role(v_session.mode) then
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

-- Lobby → cancelled (anyone in the session). Running → completed: 'completed' when
-- the controller ends it, 'ended_early' when the other side leaves.
create or replace function public.end_session(p_session uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.session_participants := public.require_participant(p_session);
  v_session public.interview_sessions;
  v_reason text;
begin
  select * into v_session from public.interview_sessions where id = p_session for update;
  if v_session.status = 'lobby' then
    v_reason := 'cancelled';
    update public.interview_sessions set status = 'cancelled', ended_at = now(), end_reason = v_reason
    where id = p_session;
  elsif v_session.status = 'in_progress' then
    v_reason := case when v_me.role = public.session_controller_role(v_session.mode) then 'completed' else 'ended_early' end;
    update public.interview_sessions set status = 'completed', ended_at = now(), end_reason = v_reason
    where id = p_session;
  else
    return v_session.end_reason; -- already ended: idempotent
  end if;

  update public.session_invites set revoked_at = now()
  where session_id = p_session and revoked_at is null and accepted_at is null;

  perform public.append_session_event(p_session, v_me.id, v_me.role, 'session.ended', jsonb_build_object(
    'reason', v_reason,
    'final_phase', v_session.phase,
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
--
-- Payloads are rebuilt from validated fields, so stray keys are never stored.
-- Returns the new seq, or null when nothing changed.
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
      raise exception 'This session was cancelled' using errcode = '22023';
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
      raise exception 'This session has ended' using errcode = '22023';
    end if;
    v_text := btrim(coalesce(p_payload ->> 'text', ''));
    if char_length(v_text) not between 1 and 2000 then
      raise exception 'Messages must be 1–2,000 characters' using errcode = '22001';
    end if;
    v_event := public.append_session_event(p_session, v_me.id, v_me.role, p_type,
      jsonb_build_object('text', v_text), 'all', p_client_ts);
    return v_event.seq;
  end if;

  -- Everything below happens on the board, so the session must be running.
  if v_session.status <> 'in_progress' then
    raise exception 'The session isn''t running' using errcode = '22023';
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
      return null; -- stale or duplicate delta (e.g. an echo of the live broadcast)
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
-- save_evaluation(): draft any time after the session starts; submit once ended.
-- scores: {"<phase>": {"score": 1-4 | null, "evidence": "…"}}
-- ---------------------------------------------------------------------------

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
  v_kind text := case v_me.role when 'candidate' then 'self' else 'scorecard' end;
  v_existing public.session_evaluations;
  v_scores jsonb := coalesce(p_scores, '{}'::jsonb);
  v_summary text := btrim(coalesce(p_summary, ''));
  v_submitted timestamptz;
  v_id uuid;
begin
  select * into v_session from public.interview_sessions where id = p_session;
  if v_session.status not in ('in_progress', 'completed') then
    raise exception 'Evaluations open once the session starts' using errcode = '22023';
  end if;
  if p_submit and v_session.status <> 'completed' then
    raise exception 'You can submit once the session has ended' using errcode = '22023';
  end if;

  select * into v_existing from public.session_evaluations where session_id = p_session and participant_id = v_me.id;
  if found and v_existing.submitted_at is not null then
    raise exception 'You already submitted this evaluation' using errcode = '42501';
  end if;

  -- Shape checks: known phases only; score 1–4 or null; evidence ≤ 2,000 chars.
  if jsonb_typeof(v_scores) <> 'object' or exists (
    select 1 from jsonb_each(v_scores) as s(k, v)
    where not (k = any (public.interview_phases()))
       or jsonb_typeof(v) <> 'object'
       or (v ? 'score' and jsonb_typeof(v -> 'score') not in ('number', 'null'))
       or (jsonb_typeof(v -> 'score') = 'number' and (v ->> 'score') not in ('1', '2', '3', '4'))
       or (v ? 'evidence' and jsonb_typeof(v -> 'evidence') <> 'string')
       or char_length(coalesce(v ->> 'evidence', '')) > 2000
  ) then
    raise exception 'Invalid scores' using errcode = '22023';
  end if;
  if v_kind = 'self' and p_recommendation is not null then
    raise exception 'A self-assessment has no hiring recommendation' using errcode = '22023';
  end if;
  if char_length(v_summary) > 5000 then
    raise exception 'The summary is limited to 5,000 characters' using errcode = '22001';
  end if;
  if p_submit then
    if not exists (select 1 from jsonb_each(v_scores) as s(k, v) where jsonb_typeof(v -> 'score') = 'number') then
      raise exception 'Score at least one phase before submitting' using errcode = '22023';
    end if;
    if v_kind = 'scorecard' and (p_recommendation is null or char_length(v_summary) = 0) then
      raise exception 'A scorecard needs a recommendation and a summary' using errcode = '22023';
    end if;
  end if;

  v_submitted := case when p_submit then now() end;
  insert into public.session_evaluations (session_id, participant_id, kind, scores, recommendation, summary, submitted_at)
  values (p_session, v_me.id, v_kind, v_scores, p_recommendation, v_summary, v_submitted)
  on conflict (session_id, participant_id) do update
    set scores = excluded.scores, recommendation = excluded.recommendation,
        summary = excluded.summary, submitted_at = excluded.submitted_at
  returning id into v_id;

  if p_submit then
    perform public.append_session_event(p_session, v_me.id, v_me.role, 'evaluation.submitted', jsonb_build_object(
      'evaluation_id', v_id,
      'kind', v_kind,
      'content_hash', encode(sha256(convert_to(
        jsonb_build_object('scores', v_scores, 'recommendation', p_recommendation, 'summary', v_summary)::text,
        'UTF8')), 'hex')
    ));
  end if;
  return v_submitted;
end;
$$;

-- ---------------------------------------------------------------------------
-- verify_session_log(): recompute the hash chain. Any participant can run it;
-- it covers private events too but reveals only pass/fail.
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
  perform public.require_participant(p_session);
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
    ok := false; -- events were removed from the end
    first_bad_seq := v_expected_seq;
  end if;
  head_hash := v_prev;
  return next;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row-level security and grants
-- ---------------------------------------------------------------------------

alter table public.interview_sessions enable row level security;
alter table public.session_participants enable row level security;
alter table public.session_invites enable row level security;
alter table public.session_events enable row level security;
alter table public.session_interviewer_notes enable row level security;
alter table public.session_evaluations enable row level security;

revoke all on public.interview_sessions, public.session_participants, public.session_invites,
  public.session_events, public.session_interviewer_notes, public.session_evaluations
  from anon, authenticated;

-- Read-only for participants; all writes go through the functions above.
grant select on public.interview_sessions, public.session_participants, public.session_events,
  public.session_interviewer_notes, public.session_evaluations to authenticated;

create policy "Participants can read their sessions"
  on public.interview_sessions for select to authenticated
  using (public.session_role(id) is not null);

create policy "Participants can see who is in their sessions"
  on public.session_participants for select to authenticated
  using (public.session_role(session_id) is not null);

create policy "Participants read events they are allowed to see"
  on public.session_events for select to authenticated
  using (
    case visibility
      when 'all' then public.session_role(session_id) is not null
      else public.session_role(session_id) = 'interviewer'
    end
  );

create policy "Interviewers read their own private notes"
  on public.session_interviewer_notes for select to authenticated
  using (participant_id = public.session_participant_id(session_id));

create policy "Evaluations are released per ADR 0006"
  on public.session_evaluations for select to authenticated
  using (public.can_read_evaluation(session_id, participant_id, submitted_at));

-- session_invites: no client access at all (only token hashes live there anyway).

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
  public.interview_phases(),
  public.phase_plan_valid(jsonb),
  public.anonymize_participant(),
  public.reject_event_mutation(),
  public.reject_submitted_evaluation_change(),
  public.session_event_hash(text, uuid, bigint, uuid, text, text, text, jsonb, timestamptz),
  public.session_genesis_hash(uuid),
  public.session_role(uuid),
  public.session_participant_id(uuid),
  public.session_controller_role(text),
  public.can_read_evaluation(uuid, uuid, timestamptz),
  public.realtime_topic_allowed(text, boolean),
  public.merge_board(jsonb, jsonb),
  public.append_session_event(uuid, uuid, text, text, jsonb, text, timestamptz),
  public.require_participant(uuid),
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
  public.verify_session_log(uuid)
from public, anon, authenticated;

-- Used inside RLS policies, so the querying role needs execute.
grant execute on function
  public.interview_phases(),
  public.session_role(uuid),
  public.session_participant_id(uuid),
  public.can_read_evaluation(uuid, uuid, timestamptz),
  public.realtime_topic_allowed(text, boolean)
to authenticated;

-- The client-facing API.
grant execute on function
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
  public.verify_session_log(uuid)
to authenticated;
