-- Probewise · Phase 1 · Milestone 1 foundation
-- Profiles, the 100-seat sign-up cap, the overflow waitlist and row-level security.
--
-- Seat model (see README "Decisions"):
--   * Anyone can authenticate (magic link / OAuth). Authenticating alone does NOT
--     consume a seat, so unconfirmed or abandoned sign-ups can't squat seats.
--   * After a verified login the app calls public.claim_seat(). It creates the
--     profile (= a seat) if one is free, otherwise puts the user on the waitlist.
--   * Freed seats go to the waitlist first, in join order (FIFO).
--   * The cap lives in public.app_config so it can be raised without a deploy.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.text_items_valid(items text[], max_len integer)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(bool_and(char_length(btrim(i)) between 1 and max_len), true)
  from unnest(items) as i
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- app_config: single-row settings table (not exposed to clients)
-- ---------------------------------------------------------------------------

create table public.app_config (
  id boolean primary key default true check (id),
  seat_cap integer not null default 100 check (seat_cap >= 0),
  updated_at timestamptz not null default now()
);

insert into public.app_config (id, seat_cap) values (true, 100);

create trigger app_config_updated_at
  before update on public.app_config
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- profiles: one row per member (a claimed seat)
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text check (full_name is null or char_length(btrim(full_name)) between 1 and 100),
  -- keep these lists in sync with src/lib/profile-options.ts (a test checks this)
  target_role text check (target_role in (
    'backend_engineer', 'fullstack_engineer', 'frontend_engineer', 'mobile_engineer',
    'ml_engineer', 'data_engineer', 'platform_sre', 'engineering_manager'
  )),
  seniority text check (seniority in ('entry', 'mid', 'senior', 'staff', 'principal')),
  domains text[] not null default '{}' check (
    cardinality(domains) <= 3
    and domains <@ array[
      'fintech', 'ecommerce', 'social', 'media_streaming', 'mobility_logistics', 'healthcare',
      'ai_ml', 'adtech', 'b2b_saas', 'gaming', 'devtools_infra', 'travel_hospitality'
    ]::text[]
  ),
  target_companies text[] not null default '{}' check (
    cardinality(target_companies) <= 5 and public.text_items_valid(target_companies, 60)
  ),
  years_experience smallint check (years_experience between 0 and 50),
  weak_areas text[] not null default '{}' check (
    weak_areas <@ array[
      'requirements_gathering', 'capacity_estimation', 'api_design', 'data_modeling',
      'scalability', 'consistency_availability', 'caching', 'messaging_queues',
      'reliability_failure', 'observability', 'security', 'communication'
    ]::text[]
  ),
  interview_date date,
  onboarding_completed_at timestamptz,
  seat_claimed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- a profile can only be marked complete once the required fields are present
  constraint onboarding_complete_requires_fields check (
    onboarding_completed_at is null or (
      full_name is not null
      and target_role is not null
      and seniority is not null
      and years_experience is not null
      and cardinality(domains) >= 1
    )
  )
);

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- waitlist: authenticated users who arrived after the cap was reached
-- ---------------------------------------------------------------------------

create table public.waitlist (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text,
  joined_at timestamptz not null default now()
);

create index waitlist_order_idx on public.waitlist (joined_at, user_id);

-- ---------------------------------------------------------------------------
-- Row-level security and grants
-- ---------------------------------------------------------------------------

alter table public.app_config enable row level security;
alter table public.profiles enable row level security;
alter table public.waitlist enable row level security;

revoke all on public.app_config from anon, authenticated;
revoke all on public.profiles from anon, authenticated;
revoke all on public.waitlist from anon, authenticated;

-- Members read and edit only their own profile, and only the editable columns.
-- Rows are created exclusively by claim_seat(); id, email and seat columns are read-only.
grant select on public.profiles to authenticated;
grant update (
  full_name, target_role, seniority, domains, target_companies,
  years_experience, weak_areas, interview_date, onboarding_completed_at
) on public.profiles to authenticated;

create policy "Members can read their own profile"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()));

create policy "Members can update their own profile"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

grant select on public.waitlist to authenticated;

create policy "Users can read their own waitlist entry"
  on public.waitlist for select to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- claim_seat(): the only way a profile (seat) is created
-- Returns 'member' or 'waitlisted'. Safe to call on every login.
-- ---------------------------------------------------------------------------

create or replace function public.claim_seat()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_cap integer;
  v_free integer;
  v_joined timestamptz;
  v_position integer;
  v_waiting integer;
  v_allowed boolean;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  -- Fast path: already a member.
  if exists (select 1 from public.profiles where id = v_uid) then
    return 'member';
  end if;

  -- Serialize seat allocation so concurrent sign-ups can't exceed the cap.
  perform pg_advisory_xact_lock(hashtext('probewise.claim_seat'));

  -- Re-check under the lock (same user in two tabs).
  if exists (select 1 from public.profiles where id = v_uid) then
    return 'member';
  end if;

  select seat_cap into v_cap from public.app_config where id;
  v_free := coalesce(v_cap, 0) - (select count(*) from public.profiles);
  select email into v_email from auth.users where id = v_uid;

  select joined_at into v_joined from public.waitlist where user_id = v_uid;
  if found then
    -- Waitlisted users are admitted in join order.
    select count(*) into v_position
    from public.waitlist
    where (joined_at, user_id) <= (v_joined, v_uid);
    v_allowed := v_free >= v_position;
  else
    -- Newcomers only get a seat if nobody is waiting for it.
    select count(*) into v_waiting from public.waitlist;
    v_allowed := v_free > v_waiting;
  end if;

  if v_allowed then
    insert into public.profiles (id, email) values (v_uid, v_email);
    delete from public.waitlist where user_id = v_uid;
    return 'member';
  end if;

  insert into public.waitlist (user_id, email)
  values (v_uid, v_email)
  on conflict (user_id) do nothing;
  return 'waitlisted';
end;
$$;

-- ---------------------------------------------------------------------------
-- seats_remaining(): public counter for the landing page
-- Seats a brand-new visitor could still get (waitlisted users are ahead of them).
-- ---------------------------------------------------------------------------

create or replace function public.seats_remaining()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(
    (select seat_cap from public.app_config where id)
      - (select count(*) from public.profiles)::integer
      - (select count(*) from public.waitlist)::integer,
    0
  )
$$;

-- ---------------------------------------------------------------------------
-- waitlist_status(): the caller's position in line
-- ---------------------------------------------------------------------------

create or replace function public.waitlist_status()
returns table (queue_position integer, total_waiting integer, joined_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select count(*)::integer from public.waitlist w2
      where (w2.joined_at, w2.user_id) <= (w.joined_at, w.user_id)),
    (select count(*)::integer from public.waitlist),
    w.joined_at
  from public.waitlist w
  where w.user_id = auth.uid()
$$;

-- ---------------------------------------------------------------------------
-- delete_my_account(): removes the caller's auth user; cascades to profile /
-- waitlist and frees the seat for the next person in line.
-- ---------------------------------------------------------------------------

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  delete from auth.users where id = v_uid;
end;
$$;

-- ---------------------------------------------------------------------------
-- Keep stored emails in sync when a user changes their auth email.
-- ---------------------------------------------------------------------------

create or replace function public.sync_user_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles set email = new.email where id = new.id;
  update public.waitlist set email = new.email where user_id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row
  when (old.email is distinct from new.email)
  execute function public.sync_user_email();

-- ---------------------------------------------------------------------------
-- Function privileges (functions are executable by PUBLIC by default)
-- ---------------------------------------------------------------------------

revoke all on function public.claim_seat() from public, anon;
revoke all on function public.waitlist_status() from public, anon;
revoke all on function public.delete_my_account() from public, anon;
revoke all on function public.sync_user_email() from public, anon, authenticated;
revoke all on function public.seats_remaining() from public;

grant execute on function public.claim_seat() to authenticated;
grant execute on function public.waitlist_status() to authenticated;
grant execute on function public.delete_my_account() to authenticated;
grant execute on function public.seats_remaining() to anon, authenticated;
