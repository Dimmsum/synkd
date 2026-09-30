-- WF-127: offline friends, the database half (PRD §6.3 FR-SOC-14, FR-SOC-15,
-- FR-SOC-16, FR-SOC-18; §9 `offlineFriends`; NFR-COMP-9, R14, D35, D41, D44).
--
-- A user can add someone who isn't on whosfree, known only by a nickname, and
-- give them a schedule (upload or manual entry). The person never agreed to
-- our terms, so the data is minimised (a nickname, an optional emoji and a
-- schedule; no contact details, photos or locations) and is visible to the
-- user who added them and to nobody else, at any tier (FR-SOC-15).
--
-- Schedules reuse `sources` and `events`: a row whose `offline_friend_id` is
-- set belongs to that offline friend, not to `user_id` (who owns it and is the
-- only one who can read it). Such rows are never part of the owner's own
-- availability and never returned to other viewers: the next migration
-- (20261002300100) makes every read path of another user's schedule skip them.
--
-- Clients read their own offline_friends rows under RLS but write only
-- through the functions below, which take the owner from current_user_id().
--
-- Errors (OFFLINE_FRIEND_ERRORS in packages/backend/src/index.ts): WF001 no
-- account for this sign-in, 22023 bad argument (nickname, emoji, missing
-- permission tick), P0001 the per-user limit is reached, P0002 not found
-- (also for another user's offline friend), PT429 rate limited.

-- ---------------------------------------------------------------------------
-- offline_friends
-- ---------------------------------------------------------------------------
create table public.offline_friends (
  id uuid primary key default gen_random_uuid(),
  -- The owner: the user who added them. Deleting the account deletes their
  -- offline friends and, through them, their schedules (NFR-COMP-9).
  user_id uuid not null references public.users (id) on delete cascade,
  -- OfflineFriendNickname in @whosfree/shared: trimmed, 1–40 characters
  -- (OFFLINE_FRIEND_NICKNAME_MAX_LENGTH), no control characters.
  nickname text not null check (
    char_length(nickname) between 1 and 40
    and nickname !~ '^\s|\s$'
    and nickname !~ '[[:cntrl:]]'
  ),
  -- Optional, validated like a group's emoji (private.clean_group_emoji).
  emoji text check (emoji is null or char_length(emoji) between 1 and 16),
  -- FR-SOC-16: when the owner confirmed they have the person's permission.
  permission_confirmed_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Target of the composite foreign keys from sources and events, so a
  -- schedule row can only point at an offline friend of its own user_id.
  constraint offline_friends_id_user_key unique (id, user_id)
);
create index offline_friends_user_id_idx on public.offline_friends (user_id);

comment on table public.offline_friends is
  'People who aren''t on whosfree, added by a user (D44, FR-SOC-14). Owner-only under RLS and never readable by anyone else (FR-SOC-15). Written by create/update/delete_offline_friend. At most MAX_OFFLINE_FRIENDS (20) per user.';

-- ---------------------------------------------------------------------------
-- sources and events gain offline_friend_id.
--
-- The composite foreign key (offline_friend_id, user_id) makes the offline
-- friend's owner equal the row's user_id, so RLS on user_id (owner-only)
-- covers these rows too. It is only checked when offline_friend_id is set
-- (MATCH SIMPLE). Deleting the offline friend deletes their sources and
-- events straight away (FR-SOC-18).
-- ---------------------------------------------------------------------------
alter table public.sources
  add column offline_friend_id uuid,
  add constraint sources_offline_friend_same_user foreign key (offline_friend_id, user_id)
    references public.offline_friends (id, user_id) on delete cascade,
  -- FR-SOC-14: an offline friend's schedule is uploaded or typed in; they have
  -- no Google account connected to us.
  add constraint sources_offline_friend_not_gcal check (offline_friend_id is null or type <> 'gcal');
create index sources_offline_friend_id_idx on public.sources (offline_friend_id)
  where offline_friend_id is not null;

comment on column public.sources.offline_friend_id is
  'Set when the schedule belongs to this offline friend of user_id, not to user_id (D44). Can''t be changed once set.';

alter table public.events
  add column offline_friend_id uuid,
  add constraint events_offline_friend_same_user foreign key (offline_friend_id, user_id)
    references public.offline_friends (id, user_id) on delete cascade;
create index events_offline_friend_id_starts_at_idx on public.events (offline_friend_id, starts_at)
  where offline_friend_id is not null;

comment on column public.events.offline_friend_id is
  'Set when the event belongs to this offline friend of user_id (D44); always equal to its source''s. Such events are never part of user_id''s own availability and never returned to other viewers.';

-- An event belongs to the same person as its source: the user themself (both
-- null) or the same offline friend. Checked on every insert and on any change
-- of source or offline friend. The source is read as the caller, so under RLS
-- a client only finds its own sources; any other source_id is rejected by the
-- events_source_same_user foreign key anyway.
create function private.check_event_offline_friend() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  source_friend uuid;
begin
  select s.offline_friend_id into source_friend
  from public.sources s
  where s.id = new.source_id;
  if found and new.offline_friend_id is distinct from source_friend then
    raise exception 'An event must belong to the same person as its source'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function private.check_event_offline_friend() from public;

create trigger events_check_offline_friend
  before insert or update of source_id, offline_friend_id on public.events
  for each row execute function private.check_event_offline_friend();

-- A source can't move between the user and an offline friend (or between two
-- offline friends): its events would then belong to the wrong person. To
-- re-upload, replace the source.
create function private.protect_source_offline_friend() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.offline_friend_id is distinct from old.offline_friend_id then
    raise exception 'A source''s offline friend can''t be changed' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function private.protect_source_offline_friend() from public;

create trigger sources_protect_offline_friend
  before update of offline_friend_id on public.sources
  for each row execute function private.protect_source_offline_friend();

-- ---------------------------------------------------------------------------
-- private.clean_offline_friend_nickname(nickname): the nickname without
-- surrounding whitespace, 1–40 characters and no control characters (same
-- rules as OfflineFriendNickname in @whosfree/shared).
-- ---------------------------------------------------------------------------
create function private.clean_offline_friend_nickname(nickname text) returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  cleaned text := pg_catalog.regexp_replace(nickname, '^\s+|\s+$', '', 'g');
begin
  if cleaned is null or pg_catalog.char_length(cleaned) not between 1 and 40 then
    raise exception 'Nickname must be 1 to 40 characters' using errcode = '22023';
  end if;
  if cleaned ~ '[[:cntrl:]]' then
    raise exception 'Nickname must not contain control characters' using errcode = '22023';
  end if;
  return cleaned;
end;
$$;

revoke all on function private.clean_offline_friend_nickname(text) from public;

-- ---------------------------------------------------------------------------
-- create_offline_friend(nickname, emoji, permission_confirmed): adds an
-- offline friend for the caller and returns its id. Refused unless the caller
-- ticked "I have their permission to add their schedule" (FR-SOC-16); the
-- time of the confirmation is recorded.
--
-- The cap (MAX_OFFLINE_FRIENDS in @whosfree/shared, FR-SOC-18) is checked
-- after locking the caller's users row, so two concurrent calls can't both
-- see 19 and make 21.
-- ---------------------------------------------------------------------------
create function public.create_offline_friend(
  nickname text,
  emoji text default null,
  permission_confirmed boolean default false
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  -- MAX_OFFLINE_FRIENDS in @whosfree/shared.
  max_offline_friends constant integer := 20;
  me uuid := private.require_user();
  clean_nickname text := private.clean_offline_friend_nickname(create_offline_friend.nickname);
  clean_emoji text := private.clean_group_emoji(create_offline_friend.emoji);
  new_id uuid;
begin
  if create_offline_friend.permission_confirmed is not true then
    raise exception 'Confirm you have their permission to add their schedule'
      using errcode = '22023';
  end if;

  perform 1 from public.users u where u.id = me for update;

  if (select count(*) from public.offline_friends o where o.user_id = me) >= max_offline_friends then
    raise exception 'You have reached the limit of offline friends' using errcode = 'P0001';
  end if;

  -- NFR-SEC-9, R14: at most 20 new offline friends per user per day. Enough
  -- to add everyone on the first day, but stops delete-and-re-add churn around
  -- the cap. Only counted when one is actually created (rolls back otherwise).
  perform private.consume_rate_limit(me, 'create_offline_friend', 20, interval '1 day');

  insert into public.offline_friends (user_id, nickname, emoji, permission_confirmed_at)
  values (me, clean_nickname, clean_emoji, pg_catalog.now())
  returning offline_friends.id into new_id;

  return new_id;
end;
$$;

comment on function public.create_offline_friend(text, text, boolean) is
  'WF-127: adds an offline friend for the caller (FR-SOC-14, FR-SOC-16). Needs permission_confirmed = true; at most 20 per user.';

revoke all on function public.create_offline_friend(text, text, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.create_offline_friend(text, text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- update_offline_friend(offline_friend_id, nickname, emoji): renames one of
-- the caller's offline friends and sets its emoji (null = none). Another
-- user's offline friend is "not found", whether or not it exists.
-- ---------------------------------------------------------------------------
create function public.update_offline_friend(offline_friend_id uuid, nickname text, emoji text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := private.require_user();
  clean_nickname text := private.clean_offline_friend_nickname(update_offline_friend.nickname);
  clean_emoji text := private.clean_group_emoji(update_offline_friend.emoji);
begin
  update public.offline_friends o
  set nickname = clean_nickname, emoji = clean_emoji, updated_at = pg_catalog.now()
  where o.id = update_offline_friend.offline_friend_id
    and o.user_id = me;
  if not found then
    raise exception 'Offline friend not found' using errcode = 'P0002';
  end if;
end;
$$;

comment on function public.update_offline_friend(uuid, text, text) is
  'WF-127: renames one of the caller''s offline friends and sets its emoji (FR-SOC-18).';

revoke all on function public.update_offline_friend(uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.update_offline_friend(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- delete_offline_friend(offline_friend_id): deletes one of the caller's
-- offline friends. Their sources and events go with it in the same statement
-- (on delete cascade), so the schedule is gone straight away (FR-SOC-18).
-- ---------------------------------------------------------------------------
create function public.delete_offline_friend(offline_friend_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := private.require_user();
begin
  delete from public.offline_friends o
  where o.id = delete_offline_friend.offline_friend_id
    and o.user_id = me;
  if not found then
    raise exception 'Offline friend not found' using errcode = 'P0002';
  end if;
end;
$$;

comment on function public.delete_offline_friend(uuid) is
  'WF-127: deletes one of the caller''s offline friends with their schedule (FR-SOC-18).';

revoke all on function public.delete_offline_friend(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.delete_offline_friend(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- list_offline_friends(): the caller's offline friends, oldest first, and
-- whether each has a schedule yet (at least one source), for the "Not on
-- whosfree" section (WF-128). Their events are read directly under RLS
-- (`events` where offline_friend_id = the id).
--
-- Security invoker: RLS applies, so it can only ever return the caller's own
-- rows. No rows without a users row for the token.
-- ---------------------------------------------------------------------------
create function public.list_offline_friends()
returns table (
  id uuid,
  nickname text,
  emoji text,
  permission_confirmed_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  has_schedule boolean
)
language sql
stable
set search_path = ''
as $$
  select
    o.id,
    o.nickname,
    o.emoji,
    o.permission_confirmed_at,
    o.created_at,
    o.updated_at,
    exists (select 1 from public.sources s where s.offline_friend_id = o.id)
  from public.offline_friends o
  where o.user_id = public.current_user_id()
  order by o.created_at, o.id
$$;

comment on function public.list_offline_friends() is
  'WF-127: the caller''s offline friends and whether each has a schedule. Runs under RLS.';

revoke all on function public.list_offline_friends()
  from public, anon, authenticated, service_role;
grant execute on function public.list_offline_friends() to authenticated;

-- ---------------------------------------------------------------------------
-- Privileges and RLS: the owner reads their own rows; nobody writes directly.
-- ---------------------------------------------------------------------------
alter table public.offline_friends enable row level security;

revoke all on table public.offline_friends from anon, authenticated;
grant select on table public.offline_friends to authenticated;

create policy offline_friends_select_own on public.offline_friends
  for select to authenticated
  using (user_id = (select public.current_user_id()));
