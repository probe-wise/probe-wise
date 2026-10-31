-- Probewise · Rounds, custom problems and rubrics, loops, calendar
--
--   * Round types: system design (whiteboard), coding (shared code editor) and
--     behavioural (conversation). Each has its own phases and default rubric (ADR 0010).
--   * Workspaces write their own problems and rubrics. A session snapshots the rubric
--     it's graded on, so editing a rubric never changes past scorecards (ADR 0011).
--   * Loops group several rounds for one candidate into one summary (ADR 0012).
--   * Calendar: Google Calendar events (default) or .ics invites, per workspace. OAuth
--     refresh tokens are encrypted by the server and only the service role touches them
--     (ADR 0013).
--
-- Vocabularies here are repeated in src/lib/interview/rounds.ts; tests check they match.

-- ---------------------------------------------------------------------------
-- Vocabularies
-- ---------------------------------------------------------------------------

create or replace function public.round_types()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['system_design', 'coding', 'behavioural']::text[]
$$;

create or replace function public.round_phases(p_round text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_round
    when 'system_design' then public.interview_phases()
    when 'coding' then array['understand', 'approach', 'implement', 'test', 'complexity']::text[]
    when 'behavioural' then array['intro', 'experience', 'scenarios', 'candidate_questions']::text[]
  end
$$;

-- Aspect keys of each round type's built-in rubric (used for sessions created before
-- rubrics were snapshotted).
create or replace function public.default_aspects(p_round text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_round
    when 'system_design' then public.evaluation_aspects()
    when 'coding' then array['problem_solving', 'code_quality', 'correctness', 'complexity', 'communication']::text[]
    when 'behavioural' then array['ownership', 'collaboration', 'judgement', 'impact', 'self_awareness', 'communication']::text[]
  end
$$;

create or replace function public.code_languages()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['python', 'javascript', 'typescript', 'java', 'cpp', 'go']::text[]
$$;

-- A phase plan is {"<phase>": minutes, …} with every phase of the round, 1–60 minutes each.
create or replace function public.round_plan_valid(plan jsonb, p_round text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(plan) = 'object'
    and public.round_phases(p_round) is not null
    and (select array_agg(k order by k) from jsonb_object_keys(plan) as k)
      = (select array_agg(p order by p) from unnest(public.round_phases(p_round)) as p)
    and (select bool_and(jsonb_typeof(v) = 'number' and (v::text)::numeric between 1 and 60
                         and (v::text)::numeric = trunc((v::text)::numeric))
         from jsonb_each(plan) as e(k, v))
$$;

-- A rubric: {"name": "…", "aspects": [{"key", "label", "assesses", "solid": ["…"]}, …]}
create or replace function public.rubric_valid(r jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(r) = 'object'
    and octet_length(r::text) <= 20000
    and char_length(btrim(coalesce(r ->> 'name', ''))) between 1 and 80
    and jsonb_typeof(r -> 'aspects') = 'array'
    and jsonb_array_length(r -> 'aspects') between 1 and 12
    and not exists (
      select 1 from jsonb_array_elements(r -> 'aspects') as a(el)
      where jsonb_typeof(el) <> 'object'
         or coalesce(el ->> 'key', '') !~ '^[a-z][a-z0-9_]{0,39}$'
         or char_length(btrim(coalesce(el ->> 'label', ''))) not between 1 and 60
         or char_length(coalesce(el ->> 'assesses', '')) > 300
         or (el ? 'solid' and (
              jsonb_typeof(el -> 'solid') <> 'array' or jsonb_array_length(el -> 'solid') > 8
              or exists (select 1 from jsonb_array_elements(el -> 'solid') as s(x)
                         where jsonb_typeof(x) <> 'string' or char_length(x #>> '{}') > 300)))
    )
    and (select count(distinct el ->> 'key') = count(*) from jsonb_array_elements(r -> 'aspects') as a(el))
$$;

-- ---------------------------------------------------------------------------
-- problems: a workspace's own problems (the built-in bank stays in code, ADR 0004)
-- ---------------------------------------------------------------------------

create table public.problems (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  round_type text not null check (round_type = any (public.round_types())),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  summary text not null default '' check (char_length(summary) <= 500),
  prompt text not null check (char_length(btrim(prompt)) between 1 and 8000),
  focus text not null default '' check (char_length(focus) <= 200),
  levels text[] not null default '{}' check (levels <@ array['entry', 'mid', 'senior', 'staff', 'principal']::text[]),
  language text check (language = any (public.code_languages())),
  starter_code text not null default '' check (char_length(starter_code) <= 20000),
  -- The confidential interviewer guide: {clarifications, scale, probes, strongSignals, pitfalls, reference}
  guide jsonb not null default '{}' check (jsonb_typeof(guide) = 'object' and octet_length(guide::text) <= 65536),
  version integer not null default 1,
  archived_at timestamptz,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (round_type = 'coding' or (language is null and starter_code = ''))
);

create index problems_org_idx on public.problems (org_id, round_type);

-- Bump the version whenever what candidates or interviewers see changes.
create or replace function public.bump_problem_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.prompt, new.title, new.guide, new.starter_code, new.language, new.summary, new.focus)
     is distinct from (old.prompt, old.title, old.guide, old.starter_code, old.language, old.summary, old.focus) then
    new.version := old.version + 1;
  end if;
  new.round_type := old.round_type;
  new.updated_at := now();
  return new;
end;
$$;

create trigger problems_versioned
  before update on public.problems
  for each row execute function public.bump_problem_version();

-- ---------------------------------------------------------------------------
-- rubrics: a workspace's own rubrics, one optional default per round type
-- ---------------------------------------------------------------------------

create table public.rubrics (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  round_type text not null check (round_type = any (public.round_types())),
  name text not null,
  aspects jsonb not null,
  is_default boolean not null default false,
  archived_at timestamptz,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (public.rubric_valid(jsonb_build_object('name', name, 'aspects', aspects))),
  check (not (is_default and archived_at is not null))
);

create unique index rubrics_one_default on public.rubrics (org_id, round_type) where is_default;

create trigger rubrics_updated_at
  before update on public.rubrics
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- interview_loops: several rounds for one candidate, summarised together
-- ---------------------------------------------------------------------------

create table public.interview_loops (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  candidate_id uuid not null references public.candidates (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create index interview_loops_candidate_idx on public.interview_loops (candidate_id, created_at desc);

-- ---------------------------------------------------------------------------
-- interview_sessions: round type, rubric snapshot, loop, code, calendar
-- ---------------------------------------------------------------------------

alter table public.interview_sessions
  drop constraint if exists interview_sessions_phase_check,
  drop constraint if exists interview_sessions_phase_plan_check,
  add column round_type text not null default 'system_design' check (round_type = any (public.round_types())),
  add column problem_id uuid references public.problems (id) on delete set null,
  -- The rubric this interview is graded on, as it was when scheduled. Null on older rows: built-in default.
  add column rubric jsonb check (rubric is null or public.rubric_valid(rubric)),
  add column loop_id uuid references public.interview_loops (id) on delete set null,
  add column code text not null default '' check (char_length(code) <= 100000),
  add column code_language text check (code_language = any (public.code_languages())),
  add column calendar_event_id text check (char_length(calendar_event_id) <= 1024),
  add column calendar_owner uuid references auth.users (id) on delete set null,
  add column meeting_url text check (meeting_url ~ '^https://' and char_length(meeting_url) <= 500),
  add constraint session_phase_in_round check (phase is null or phase = any (public.round_phases(round_type))),
  add constraint session_plan_fits_round check (public.round_plan_valid(phase_plan, round_type));

create index interview_sessions_loop_idx on public.interview_sessions (loop_id);

-- Aspect keys a session is graded on.
create or replace function public.session_aspects(p_session uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select array_agg(el ->> 'key' order by o)
     from public.interview_sessions s, jsonb_array_elements(s.rubric -> 'aspects') with ordinality as a(el, o)
     where s.id = p_session and s.rubric is not null),
    (select public.default_aspects(round_type) from public.interview_sessions where id = p_session)
  )
$$;

drop function public.scores_valid(jsonb);

create or replace function public.scores_valid(p_scores jsonb, p_aspects text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p_scores) = 'object' and not exists (
    select 1 from jsonb_each(p_scores) as s(k, v)
    where not (k = any (p_aspects))
       or jsonb_typeof(v) <> 'object'
       or (v ? 'score' and jsonb_typeof(v -> 'score') not in ('number', 'null'))
       or (jsonb_typeof(v -> 'score') = 'number' and (v ->> 'score') not in ('1', '2', '3', '4'))
       or (v ? 'evidence' and jsonb_typeof(v -> 'evidence') <> 'string')
       or char_length(coalesce(v ->> 'evidence', '')) > 2000
  )
$$;

-- session_events: code edits join the vocabulary (keep in sync with EVENT_TYPES).
alter table public.session_events drop constraint session_events_type_check;
alter table public.session_events add constraint session_events_type_check check (type in (
  'session.created', 'participant.joined', 'consent.given', 'candidate_link.created', 'candidate_links.revoked',
  'session.started', 'phase.changed', 'session.ended',
  'chat.message', 'probe.asked', 'notes.updated', 'board.updated', 'code.updated',
  'interviewer_note.updated', 'evaluation.submitted', 'ai_assessment.completed'
));

-- ---------------------------------------------------------------------------
-- create_session(): now with a round type, rubric snapshot, custom problem and loop
-- ---------------------------------------------------------------------------

drop function public.create_session(uuid, text, integer, text, jsonb, jsonb, uuid[], timestamptz);

create or replace function public.create_session(
  p_candidate uuid,
  p_round_type text,
  p_problem_slug text,
  p_problem_id uuid,
  p_problem_version integer,
  p_problem_title text,
  p_problem_snapshot jsonb,
  p_phase_plan jsonb,
  p_rubric jsonb,
  p_interviewers uuid[],
  p_scheduled_at timestamptz default null,
  p_loop uuid default null
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
  v_lang text;
begin
  if not exists (select 1 from public.candidates where id = p_candidate and org_id = v_me.org_id) then
    raise exception 'That candidate isn''t in your workspace' using errcode = 'P0002';
  end if;
  if not (p_round_type = any (public.round_types())) then
    raise exception 'Unknown round type' using errcode = '22023';
  end if;
  if p_problem_id is not null and not exists (
    select 1 from public.problems
    where id = p_problem_id and org_id = v_me.org_id and round_type = p_round_type and archived_at is null
  ) then
    raise exception 'That problem isn''t available for this round' using errcode = '22023';
  end if;
  if p_loop is not null and not exists (
    select 1 from public.interview_loops where id = p_loop and org_id = v_me.org_id and candidate_id = p_candidate
  ) then
    raise exception 'That loop isn''t for this candidate' using errcode = '22023';
  end if;
  if not public.rubric_valid(p_rubric) then
    raise exception 'Invalid rubric' using errcode = '22023';
  end if;
  if not public.round_plan_valid(p_phase_plan, p_round_type) then
    raise exception 'Invalid timings for this round' using errcode = '22023';
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
      where candidate_id = p_candidate and status in ('lobby', 'in_progress')) >= 8 then
    raise exception 'This candidate already has 8 open interviews. Finish or cancel some first' using errcode = '54000';
  end if;

  if p_round_type = 'coding' then
    v_lang := coalesce(p_problem_snapshot ->> 'language', 'python');
    if not (v_lang = any (public.code_languages())) then
      raise exception 'Unknown language' using errcode = '22023';
    end if;
  end if;

  insert into public.interview_sessions (
    id, org_id, candidate_id, created_by, scheduled_at, round_type, problem_slug, problem_id, problem_version,
    problem_title, problem_snapshot, phase_plan, rubric, loop_id, code, code_language, last_hash
  ) values (
    v_session, v_me.org_id, p_candidate, v_me.user_id, p_scheduled_at, p_round_type, p_problem_slug, p_problem_id,
    p_problem_version, btrim(p_problem_title), p_problem_snapshot, p_phase_plan, p_rubric, p_loop,
    case when p_round_type = 'coding' then left(coalesce(p_problem_snapshot ->> 'starter_code', ''), 100000) else '' end,
    v_lang, public.session_genesis_hash(v_session)
  );

  insert into public.session_participants (session_id, user_id, role, display_name)
  select v_session, m.user_id, 'interviewer', m.display_name
  from public.org_members m
  where m.org_id = v_me.org_id and m.user_id = any (v_interviewers);

  select jsonb_agg(display_name order by display_name) into v_names
  from public.session_participants where session_id = v_session;

  perform public.append_session_event(v_session, null, 'member', 'session.created', jsonb_build_object(
    'by', v_me.display_name, 'round_type', p_round_type, 'problem_slug', p_problem_slug, 'problem_id', p_problem_id,
    'problem_version', p_problem_version, 'problem_title', btrim(p_problem_title), 'phase_plan', p_phase_plan,
    'rubric', p_rubric ->> 'name', 'interviewers', v_names, 'scheduled_at', p_scheduled_at, 'loop_id', p_loop
  ));
  return v_session;
end;
$$;

-- Admins pick which rubric a round type uses by default (null: the built-in one).
create or replace function public.set_default_rubric(p_round_type text, p_rubric uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.org_members := public.require_member();
begin
  if v_me.role <> 'admin' then
    raise exception 'Only admins manage rubrics' using errcode = '42501';
  end if;
  if p_rubric is not null and not exists (
    select 1 from public.rubrics where id = p_rubric and org_id = v_me.org_id and round_type = p_round_type and archived_at is null
  ) then
    raise exception 'That rubric isn''t available for this round' using errcode = '22023';
  end if;
  update public.rubrics set is_default = false where org_id = v_me.org_id and round_type = p_round_type and is_default;
  if p_rubric is not null then
    update public.rubrics set is_default = true where id = p_rubric;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Calendar
-- ---------------------------------------------------------------------------

alter table public.organizations
  add column calendar_provider text not null default 'google' check (calendar_provider in ('google', 'ics', 'none'));

-- One calendar account per user. The refresh token is encrypted by the server
-- (CALENDAR_TOKEN_KEY) before it gets here; clients have no access at all.
create table public.calendar_connections (
  user_id uuid primary key references auth.users (id) on delete cascade,
  provider text not null default 'google' check (provider = 'google'),
  account_email text check (char_length(account_email) <= 254),
  refresh_token_ciphertext text not null check (char_length(refresh_token_ciphertext) <= 4096),
  connected_at timestamptz not null default now()
);

create or replace function public.my_calendar_connection()
returns table (provider text, account_email text, connected_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select provider, account_email, connected_at from public.calendar_connections where user_id = (select auth.uid())
$$;

create or replace function public.save_calendar_connection(p_user uuid, p_email text, p_ciphertext text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.calendar_connections (user_id, account_email, refresh_token_ciphertext)
  values (p_user, p_email, p_ciphertext)
  on conflict (user_id) do update
    set account_email = excluded.account_email, refresh_token_ciphertext = excluded.refresh_token_ciphertext,
        connected_at = now()
$$;

create or replace function public.get_calendar_connection(p_user uuid)
returns table (account_email text, refresh_token_ciphertext text)
language sql
stable
security definer
set search_path = ''
as $$
  select account_email, refresh_token_ciphertext from public.calendar_connections where user_id = p_user
$$;

create or replace function public.delete_calendar_connection(p_user uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.calendar_connections where user_id = p_user
$$;

-- Records the calendar event created for an interview (server only).
create or replace function public.set_session_calendar(p_session uuid, p_owner uuid, p_event_id text, p_meeting_url text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.interview_sessions
  set calendar_owner = p_owner, calendar_event_id = p_event_id, meeting_url = p_meeting_url
  where id = p_session
$$;

-- ---------------------------------------------------------------------------
-- Functions that change with round types and rubric snapshots
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
  v_first text;
begin
  select * into v_session from public.interview_sessions where id = p_session for update;
  v_first := (public.round_phases(v_session.round_type))[1];
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
  if not (p_phase = any (public.round_phases(v_session.round_type))) then
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
  v_lang text;
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

  if p_type = 'code.updated' then
    if v_session.round_type <> 'coding' then
      raise exception 'Only coding rounds have a code editor' using errcode = '22023';
    end if;
    if v_me.role <> 'candidate' then
      raise exception 'Only the candidate edits the code' using errcode = '42501';
    end if;
    v_text := coalesce(p_payload ->> 'text', '');
    if char_length(v_text) > 100000 then
      raise exception 'Code is limited to 100,000 characters' using errcode = '22001';
    end if;
    v_lang := coalesce(p_payload ->> 'language', v_session.code_language);
    if v_lang is null or not (v_lang = any (public.code_languages())) then
      raise exception 'Unknown language' using errcode = '22023';
    end if;
    if v_text = v_session.code and v_lang is not distinct from v_session.code_language then
      return null;
    end if;
    update public.interview_sessions set code = v_text, code_language = v_lang where id = p_session;
    v_event := public.append_session_event(p_session, v_me.id, v_me.role, p_type,
      jsonb_build_object('text', v_text, 'language', v_lang), 'all', p_client_ts);
    return v_event.seq;
  end if;

  if p_type = 'board.updated' then
    if v_session.round_type <> 'system_design' then
      raise exception 'Only system design rounds have a whiteboard' using errcode = '22023';
    end if;
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
  if not public.scores_valid(v_scores, public.session_aspects(p_session)) then
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
  if not public.scores_valid(coalesce(p_scores, '{}'::jsonb), public.session_aspects(p_session)) then
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

-- ---------------------------------------------------------------------------
-- Row-level security and grants
-- ---------------------------------------------------------------------------

alter table public.problems enable row level security;
alter table public.rubrics enable row level security;
alter table public.interview_loops enable row level security;
alter table public.calendar_connections enable row level security;

revoke all on public.problems, public.rubrics, public.interview_loops, public.calendar_connections
  from anon, authenticated;

-- Problems: the whole team writes and archives them; they're never deleted (sessions reference them).
grant select on public.problems to authenticated;
grant insert (org_id, round_type, title, summary, prompt, focus, levels, language, starter_code, guide)
  on public.problems to authenticated;
grant update (title, summary, prompt, focus, levels, language, starter_code, guide, archived_at)
  on public.problems to authenticated;

create policy "Members read their problems"
  on public.problems for select to authenticated
  using (public.is_org_member(org_id));

create policy "Members add problems"
  on public.problems for insert to authenticated
  with check (public.is_org_member(org_id));

create policy "Members edit problems"
  on public.problems for update to authenticated
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));

-- Rubrics: everyone reads; admins write (calibration is a team decision).
grant select on public.rubrics to authenticated;
grant insert (org_id, round_type, name, aspects) on public.rubrics to authenticated;
grant update (name, aspects, archived_at) on public.rubrics to authenticated;

create policy "Members read their rubrics"
  on public.rubrics for select to authenticated
  using (public.is_org_member(org_id));

create policy "Admins add rubrics"
  on public.rubrics for insert to authenticated
  with check (public.is_org_admin(org_id));

create policy "Admins edit rubrics"
  on public.rubrics for update to authenticated
  using (public.is_org_admin(org_id))
  with check (public.is_org_admin(org_id) and not (is_default and archived_at is not null));

-- Loops
grant select on public.interview_loops to authenticated;
grant insert (org_id, candidate_id, name) on public.interview_loops to authenticated;
grant update (name) on public.interview_loops to authenticated;
grant delete on public.interview_loops to authenticated;

create policy "Members read their loops"
  on public.interview_loops for select to authenticated
  using (public.is_org_member(org_id));

create policy "Members add loops for their candidates"
  on public.interview_loops for insert to authenticated
  with check (
    public.is_org_member(org_id)
    and exists (select 1 from public.candidates c where c.id = candidate_id and c.org_id = interview_loops.org_id)
  );

create policy "Members rename loops"
  on public.interview_loops for update to authenticated
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));

create policy "Admins delete loops"
  on public.interview_loops for delete to authenticated
  using (public.is_org_admin(org_id));

-- Workspace calendar setting (admins, through the existing update policy).
grant update (calendar_provider) on public.organizations to authenticated;

-- calendar_connections: no client access.

revoke all on function
  public.round_types(),
  public.round_phases(text),
  public.default_aspects(text),
  public.code_languages(),
  public.round_plan_valid(jsonb, text),
  public.rubric_valid(jsonb),
  public.bump_problem_version(),
  public.session_aspects(uuid),
  public.scores_valid(jsonb, text[]),
  public.create_session(uuid, text, text, uuid, integer, text, jsonb, jsonb, jsonb, uuid[], timestamptz, uuid),
  public.set_default_rubric(text, uuid),
  public.my_calendar_connection(),
  public.save_calendar_connection(uuid, text, text),
  public.get_calendar_connection(uuid),
  public.delete_calendar_connection(uuid),
  public.set_session_calendar(uuid, uuid, text, text)
from public, anon, authenticated;

-- Used in CHECK constraints on tables clients write to.
grant execute on function
  public.round_types(),
  public.round_phases(text),
  public.code_languages(),
  public.round_plan_valid(jsonb, text),
  public.rubric_valid(jsonb)
to authenticated;

grant execute on function
  public.create_session(uuid, text, text, uuid, integer, text, jsonb, jsonb, jsonb, uuid[], timestamptz, uuid),
  public.set_default_rubric(text, uuid),
  public.my_calendar_connection()
to authenticated;

grant execute on function
  public.save_calendar_connection(uuid, text, text),
  public.get_calendar_connection(uuid),
  public.delete_calendar_connection(uuid),
  public.set_session_calendar(uuid, uuid, text, text)
to service_role;
