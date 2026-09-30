-- whosfree: the full database schema, for a NEW, EMPTY Supabase project.
--
-- GENERATED from supabase/migrations by `pnpm --filter @whosfree/backend db:init`.
-- Do not edit by hand: change or add a migration, then regenerate. A test fails if this
-- file is out of date.
--
-- How to apply:
--   * New project: run this whole file once (SQL editor or psql). It is one transaction,
--     so if anything fails, nothing is applied.
--   * Existing project: do NOT rerun this file. Apply only the migration files newer than
--     the last one you applied, in filename order, from supabase/migrations.
--
-- Includes 15 migrations (latest last):
--   20260930201536_users_and_current_user_id.sql
--   20260930201538_visibility_tiers_and_redaction.sql
--   20261001100000_rate_limits.sql
--   20261001100100_profiles_and_handles.sql
--   20261001100200_friend_requests.sql
--   20261001100300_block_unblock_unfriend.sql
--   20261001200000_groups.sql
--   20261001200100_invites.sql
--   20261001200200_group_member_permissions.sql
--   20261001200300_leave_group.sql
--   20261001300000_ensure_current_user.sql
--   20261001300100_age_gate.sql
--   20261001300200_consent_record.sql
--   20261001300300_availability_prefs.sql
--   20261001300400_status_overrides.sql

begin;

-- ============================================================================================
-- 20260930201536_users_and_current_user_id.sql
-- ============================================================================================

-- WF-003: the `users` table and `current_user_id()` (PRD §9, D19, D40, D41).
--
-- Authorisation model (D41): Clerk signs users in and Supabase trusts Clerk's
-- session tokens through third-party auth. The Clerk user ID arrives in the
-- JWT `sub` claim (a text ID like `user_2abc...`, not a uuid, so `auth.uid()`
-- must not be used). `current_user_id()` maps it to `users.id`, and every RLS
-- policy keys on that.
--
-- Supabase grants ALL on new `public` tables and functions to `anon`,
-- `authenticated` and `service_role`, and Postgres grants EXECUTE on functions
-- to PUBLIC. Each object below therefore revokes what clients must not have
-- and grants back only what they need. RLS is the row filter on top.

-- ---------------------------------------------------------------------------
-- Private schema: helpers that clients must never call. It is not in the API's
-- exposed schemas (supabase/config.toml `[api] schemas`), and clients get no
-- USAGE on it. Functions here run only inside our security definer functions.
-- ---------------------------------------------------------------------------
create schema private;
revoke all on schema private from public;
alter default privileges for role postgres in schema private
  revoke execute on functions from public;

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
create table public.users (
  id uuid primary key default gen_random_uuid(),
  -- The Clerk user ID (JWT `sub`). Set once when the row is created (WF-004)
  -- and never changed by the user.
  clerk_id text not null unique check (char_length(clerk_id) between 1 and 255),
  name text not null check (char_length(name) between 1 and 100),
  -- Optional unique handle (`@kemar`). Format rules and reserved words are
  -- WF-040, which also decides how users set it; until then it is not
  -- client-writable. Uniqueness ignores case.
  handle text check (handle is null or char_length(handle) between 1 and 30),
  -- Only https URLs, so a client can't store a `javascript:` URL that another
  -- page might render.
  avatar_url text check (
    avatar_url is null or (avatar_url ~* '^https://' and char_length(avatar_url) <= 2048)
  ),
  -- IANA timezone name; validated by the trigger below.
  timezone text not null default 'America/Jamaica',
  -- FR-VIS-6: when true, other users see "Sharing paused" and no events.
  sharing_paused boolean not null default false,
  -- D29: only the birth year and a confirmation time; never the full date of
  -- birth. Written by the age gate (WF-005), not by the client.
  birth_year smallint check (birth_year between 1900 and 2100),
  age_confirmed_at timestamptz,
  -- WF-015: the accepted terms/privacy version. Written by the server.
  consent_version text check (consent_version is null or char_length(consent_version) <= 50),
  consent_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.users is
  'One row per person (PRD §9). Readable and partly updatable by its owner only; other users'' profiles are exposed only through security definer functions.';

create unique index users_handle_lower_key on public.users (lower(handle)) where handle is not null;

-- Reject anything that isn't a timezone name Postgres knows (e.g.
-- 'America/Jamaica'), so a bad value can't break time maths for the owner or
-- their viewers later. The shape check rules out POSIX-style specs such as
-- '<+05>-05' that Postgres accepts but JavaScript's Intl doesn't. (Looking the
-- name up in pg_timezone_names would be stricter but costs ~20 ms per call.)
create function private.validate_user_timezone() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  known boolean := true;
begin
  if new.timezone !~ '^[A-Za-z][A-Za-z0-9_+-]*(/[A-Za-z0-9_+-]+)*$' then
    known := false;
  else
    begin
      perform pg_catalog.now() at time zone new.timezone;
    exception when invalid_parameter_value then
      known := false;
    end;
  end if;
  if not known then
    raise exception 'Unknown timezone: %', new.timezone using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger users_validate_timezone
  before insert or update of timezone on public.users
  for each row execute function private.validate_user_timezone();

-- ---------------------------------------------------------------------------
-- current_user_id(): the signed-in user's `users.id`, or null.
--
-- security definer so it can read `users` without recursing into the users
-- RLS policy that calls it. It only ever returns the caller's own id.
-- ---------------------------------------------------------------------------
create function public.current_user_id() returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u.id
  from public.users u
  where u.clerk_id = (auth.jwt() ->> 'sub')
$$;

comment on function public.current_user_id() is
  'Maps the Clerk user ID in the JWT sub claim to users.id. Null when there is no token or no users row yet.';

revoke all on function public.current_user_id() from public, anon, authenticated, service_role;
grant execute on function public.current_user_id() to authenticated;

-- ---------------------------------------------------------------------------
-- users: privileges and RLS
--
-- Clients may read their own row and update only the profile fields they own.
-- `clerk_id`, `id`, `created_at`, the age gate fields, the consent fields and
-- (until WF-040) `handle` are not client-writable. Rows are created on first
-- sign-in by WF-004 (server-side), and deleted by account deletion (WF-114).
-- ---------------------------------------------------------------------------
alter table public.users enable row level security;

revoke all on table public.users from anon, authenticated;
grant select on table public.users to authenticated;
grant update (name, avatar_url, timezone, sharing_paused) on table public.users to authenticated;

create policy users_select_own on public.users
  for select to authenticated
  using (id = (select public.current_user_id()));

create policy users_update_own on public.users
  for update to authenticated
  using (id = (select public.current_user_id()))
  with check (id = (select public.current_user_id()));

-- ============================================================================================
-- 20260930201538_visibility_tiers_and_redaction.sql
-- ============================================================================================

-- WF-041: visibility tiers and server-side redaction (PRD §6.7, FR-VIS-3,
-- FR-VIS-4, FR-VIS-5, FR-VIS-6, FR-SOC-5, FR-SOC-6, FR-SOC-10, NFR-SEC-2,
-- D1, D20, D27, D35, D41).
--
-- This is the core privacy guarantee. Other users' events are never
-- selectable directly: RLS limits every table below to rows the caller owns
-- or is a party to. The only way to read someone else's schedule is
-- `public.events_for_viewer()`, which resolves the viewer's tier with
-- `private.resolve_tier()` and redacts with `private.redacted_events()`.
--
-- `resolve_tier` needs the social graph, so this migration also creates the
-- connection tables (friendships, blocks, groups, group_members,
-- visibility_rules) with their schema and RLS only. Clients cannot write to
-- them; the flows that do (friend requests WF-042, groups WF-043, invites
-- WF-045, block/leave WF-047) will be security definer functions that
-- validate each step. `sources` and `events` are created here because
-- redaction operates on them.
--
-- Tiers (D1): T1 = busy times only; T2 = + category; T3 = + title.
-- There is no location column anywhere (D35).

-- ---------------------------------------------------------------------------
-- friendships: one row per pair, users sorted so (a, b) is unique.
-- A block is NOT a friendship status: see `blocks` below.
-- ---------------------------------------------------------------------------
create table public.friendships (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references public.users (id) on delete cascade,
  user_b uuid not null references public.users (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  requested_by uuid not null,
  created_at timestamptz not null default now(),
  constraint friendships_users_sorted check (user_a < user_b),
  constraint friendships_requested_by_is_party check (requested_by in (user_a, user_b)),
  constraint friendships_pair_key unique (user_a, user_b)
);
create index friendships_user_b_idx on public.friendships (user_b);

comment on table public.friendships is
  'Friend requests and friendships (FR-SOC-1). user_a < user_b. Only accepted rows grant visibility. Blocks live in public.blocks.';

-- ---------------------------------------------------------------------------
-- blocks: directed, one row per (blocker, blocked).
--
-- Kept separate from friendships because:
--   * a blocked user must not learn they were blocked (FR-SOC-6), so the row
--     must be readable by the blocker only; a shared friendships row would be
--     visible to both parties;
--   * both people can block each other independently, and one unblocking must
--     not lift the other's block, which a single status column can't express;
--   * blocks apply between people who aren't friends (group co-members,
--     ping senders), with no friendship row to hang a status on.
-- ---------------------------------------------------------------------------
create table public.blocks (
  id uuid primary key default gen_random_uuid(),
  blocker_id uuid not null references public.users (id) on delete cascade,
  blocked_id uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint blocks_not_self check (blocker_id <> blocked_id),
  constraint blocks_pair_key unique (blocker_id, blocked_id)
);
create index blocks_blocked_id_idx on public.blocks (blocked_id);

comment on table public.blocks is
  'Directed blocks (FR-SOC-6). Readable by the blocker only, so the blocked user is never told. A block in either direction removes all visibility.';

-- ---------------------------------------------------------------------------
-- groups and group_members
-- ---------------------------------------------------------------------------
create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  emoji text check (emoji is null or char_length(emoji) between 1 and 16),
  -- FR-SOC-7: if the admin deletes their account the role passes to the
  -- longest-standing member, so account deletion (WF-114) must transfer it
  -- first; `restrict` makes a missed transfer fail loudly instead of
  -- silently deleting the group.
  admin_id uuid not null references public.users (id) on delete restrict,
  -- NFR-SCALE-4 / D17: stored per group so the cap can be raised later.
  max_members integer not null default 20 check (max_members between 1 and 1000),
  join_mode text not null default 'open' check (join_mode in ('open', 'approval')),
  created_at timestamptz not null default now()
);
create index groups_admin_id_idx on public.groups (admin_id);

create table public.group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  -- FR-SOC-10: the role grants management rights only, never extra visibility.
  role text not null default 'member' check (role in ('admin', 'member')),
  -- FR-SOC-8 permissions with the D26 defaults (invite and groupPing on).
  -- The admin always holds every permission (FR-SOC-9), whatever these say.
  can_invite boolean not null default true,
  can_manage_members boolean not null default false,
  can_edit_group boolean not null default false,
  can_group_ping boolean not null default true,
  joined_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint group_members_pair_key unique (group_id, user_id)
);
create index group_members_user_id_idx on public.group_members (user_id);
-- Exactly one admin per group is enforced by the WF-043 functions; at most one here.
create unique index group_members_one_admin_key on public.group_members (group_id)
  where role = 'admin';

-- ---------------------------------------------------------------------------
-- visibility_rules: the tier an owner grants to one friend or one group.
--
-- target_id is the friend's users.id (target_type = 'friend') or the
-- groups.id (target_type = 'group'). A rule only takes effect while the
-- connection is live (accepted friendship / both still members), so a rule
-- left behind by an unfriend or a leave grants nothing; WF-042/043/047 should
-- still delete them.
-- ---------------------------------------------------------------------------
create table public.visibility_rules (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.users (id) on delete cascade,
  target_type text not null check (target_type in ('friend', 'group')),
  target_id uuid not null,
  -- D20: T1 is the minimum for any active connection.
  tier smallint not null default 1 check (tier between 1 and 3),
  created_at timestamptz not null default now(),
  constraint visibility_rules_not_self check (not (target_type = 'friend' and target_id = owner_id)),
  constraint visibility_rules_target_key unique (owner_id, target_type, target_id)
);

-- ---------------------------------------------------------------------------
-- sources: where a user's events came from (PRD §9). Google Calendar fields
-- (calendar IDs, sync tokens, channels, encrypted refresh token) are WF-080's;
-- the refresh token must never be client-readable (NFR-SEC-3), so it should go
-- in a table clients can't select, not in this one.
-- ---------------------------------------------------------------------------
create table public.sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  type text not null check (type in ('upload', 'manual', 'gcal')),
  status text not null default 'healthy' check (status in ('healthy', 'failed', 'needs_reconnect')),
  last_synced_at timestamptz,
  -- Schedule period (FR-IMP-7, FR-IMP-8): local dates in the owner's timezone,
  -- inclusive. Exceptions are `SchedulePeriod.exceptions` from @whosfree/shared.
  period_start date,
  period_end date,
  period_exceptions jsonb not null default '[]' check (jsonb_typeof(period_exceptions) = 'array'),
  created_at timestamptz not null default now(),
  constraint sources_period_complete check ((period_start is null) = (period_end is null)),
  constraint sources_period_ordered check (period_end >= period_start),
  -- Target of the composite foreign key from events, so an event can only
  -- point at a source that belongs to the same user.
  constraint sources_id_user_key unique (id, user_id)
);
create index sources_user_id_idx on public.sources (user_id);

-- ---------------------------------------------------------------------------
-- events (PRD §9). No location column (D35).
--
-- A recurring schedule is one row with an RRULE (and EXDATEs); starts_at and
-- ends_at are the first occurrence. The RRULE must not run past the source's
-- period_end (WF-030 sets UNTIL accordingly): events_for_viewer relies on it.
-- ---------------------------------------------------------------------------
create table public.events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  source_id uuid not null,
  -- Nullable: Google titles are stored only while a T3 grant exists (D36).
  title text check (title is null or char_length(title) between 1 and 200),
  category text check (
    category is null
    or category in ('class', 'lab', 'tutorial', 'work', 'meeting', 'event', 'other')
  ),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  rrule text check (rrule is null or char_length(rrule) between 1 and 500),
  exdates timestamptz[] not null default '{}',
  -- FR-VIS-4 / FR-GCAL-8: always shown as plain "busy", whatever the tier.
  is_private boolean not null default false,
  external_id text check (external_id is null or char_length(external_id) <= 1024),
  busy boolean not null default true,
  created_at timestamptz not null default now(),
  constraint events_source_same_user foreign key (source_id, user_id)
    references public.sources (id, user_id) on delete cascade,
  constraint events_has_duration check (ends_at > starts_at),
  constraint events_exdates_need_rrule check (rrule is not null or cardinality(exdates) = 0)
);
create index events_user_id_starts_at_idx on public.events (user_id, starts_at);
create unique index events_source_external_id_key on public.events (source_id, external_id)
  where external_id is not null;

-- ---------------------------------------------------------------------------
-- private.resolve_tier(viewer, owner): the tier `viewer` may see of `owner`'s
-- schedule, or null for no access (FR-VIS-3, D20, D27).
--
--   1. viewer = owner                        -> 3
--   2. a block in either direction           -> null
--   3. accepted friendship + a friend rule   -> that rule's tier (always wins)
--   4. shared groups                         -> the minimum of the owner's rules
--                                               for those groups (no rule = 1)
--   5. accepted friendship without a rule    -> 1
--   6. anything else (pending, no connection) -> null
--
-- Group roles are ignored: an admin sees members like anyone else (FR-SOC-10).
-- Internal: clients can't execute it (it would reveal who is connected to whom).
-- It runs with the privileges of the security definer function that calls it.
-- ---------------------------------------------------------------------------
create function private.resolve_tier(viewer uuid, owner uuid) returns smallint
language plpgsql
stable
set search_path = ''
as $$
declare
  is_friend boolean;
  friend_tier smallint;
  shares_group boolean;
  group_tier smallint;
begin
  if viewer is null or owner is null then
    return null;
  end if;

  if viewer = owner then
    return 3;
  end if;

  if exists (
    select 1
    from public.blocks b
    where (b.blocker_id = viewer and b.blocked_id = owner)
       or (b.blocker_id = owner and b.blocked_id = viewer)
  ) then
    return null;
  end if;

  is_friend := exists (
    select 1
    from public.friendships f
    where f.user_a = least(viewer, owner)
      and f.user_b = greatest(viewer, owner)
      and f.status = 'accepted'
  );

  if is_friend then
    select r.tier into friend_tier
    from public.visibility_rules r
    where r.owner_id = owner
      and r.target_type = 'friend'
      and r.target_id = viewer;
    if friend_tier is not null then
      return friend_tier;
    end if;
  end if;

  select count(*) > 0, min(coalesce(r.tier, 1))
  into shares_group, group_tier
  from public.group_members owner_m
  join public.group_members viewer_m
    on viewer_m.group_id = owner_m.group_id
   and viewer_m.user_id = viewer
  left join public.visibility_rules r
    on r.owner_id = owner
   and r.target_type = 'group'
   and r.target_id = owner_m.group_id
  where owner_m.user_id = owner;

  if shares_group then
    return group_tier;
  end if;

  if is_friend then
    return 1;
  end if;

  return null;
end;
$$;

revoke all on function private.resolve_tier(uuid, uuid) from public;

-- ---------------------------------------------------------------------------
-- private.redacted_events(owner, tier, range_start, range_end): the single
-- redaction path. Every function that returns another user's events must go
-- through this (events_for_viewer now; now_for_viewer WF-064 and the "how
-- others see me" preview WF-049 later).
--
--   * only busy events;
--   * one-off events overlapping [range_start, range_end);
--   * recurring rows (rrule set) whose series may overlap the range: the first
--     occurrence starts before range_end, and the series has not ended before
--     range_start. The series end is bounded by the source's period_end (a
--     local date, inclusive): the last occurrence starts before
--     period_end + 2 days at 00:00 UTC (covers every UTC offset, -12h..+14h),
--     so it ends before that plus the event's duration. No period_end = no
--     bound. Over-inclusion is safe (the caller expands the RRULE and gets
--     nothing extra beyond what the tier allows); under-inclusion is a bug;
--   * category only from T2, title only from T3, and neither for private
--     events at any tier (FR-VIS-4). Nothing else is returned (no source,
--     external id, private flag, or non-busy events).
--
-- A null or out-of-range tier returns no rows.
-- ---------------------------------------------------------------------------
create function private.redacted_events(
  owner uuid,
  tier smallint,
  range_start timestamptz,
  range_end timestamptz
)
returns table (
  id uuid,
  starts_at timestamptz,
  ends_at timestamptz,
  rrule text,
  exdates timestamptz[],
  category text,
  title text
)
language sql
stable
set search_path = ''
as $$
  select
    e.id,
    e.starts_at,
    e.ends_at,
    e.rrule,
    e.exdates,
    case when redacted_events.tier >= 2 and not e.is_private then e.category end,
    case when redacted_events.tier >= 3 and not e.is_private then e.title end
  from public.events e
  join public.sources s on s.id = e.source_id
  where redacted_events.tier between 1 and 3
    and e.user_id = redacted_events.owner
    and e.busy
    and e.starts_at < redacted_events.range_end
    and (
      (e.rrule is null and e.ends_at > redacted_events.range_start)
      or (
        e.rrule is not null
        and (
          s.period_end is null
          or ((s.period_end + 2)::timestamp at time zone 'UTC') + (e.ends_at - e.starts_at)
            > redacted_events.range_start
        )
      )
    )
  order by e.starts_at, e.id
$$;

revoke all on function private.redacted_events(uuid, smallint, timestamptz, timestamptz) from public;

-- ---------------------------------------------------------------------------
-- public.events_for_viewer(owner_id, range_start, range_end): the owner's busy
-- events in the range, as the signed-in user is allowed to see them.
--
-- The viewer is always the caller (current_user_id()); there is no viewer
-- argument. Returns no rows when the caller has no users row, has no access
-- (no connection, pending request, block), or the owner has paused sharing
-- (FR-VIS-6; the Now layer shows "Sharing paused"). Callers can't tell these
-- cases apart from "no events", so it reveals nothing about the graph.
-- For the owner themself it returns their events at T3 but still with private
-- events redacted; their own full data is read directly under RLS.
-- ---------------------------------------------------------------------------
create function public.events_for_viewer(
  owner_id uuid,
  range_start timestamptz,
  range_end timestamptz
)
returns table (
  id uuid,
  starts_at timestamptz,
  ends_at timestamptz,
  rrule text,
  exdates timestamptz[],
  category text,
  title text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  viewer uuid;
  viewer_tier smallint;
begin
  if range_start is null or range_end is null or range_end <= range_start then
    raise exception 'range_end must be after range_start' using errcode = '22023';
  end if;

  viewer := public.current_user_id();
  if viewer is null or owner_id is null then
    return;
  end if;

  viewer_tier := private.resolve_tier(viewer, owner_id);
  if viewer_tier is null then
    return;
  end if;

  if viewer <> owner_id and exists (
    select 1 from public.users u where u.id = owner_id and u.sharing_paused
  ) then
    return;
  end if;

  return query
    select r.id, r.starts_at, r.ends_at, r.rrule, r.exdates, r.category, r.title
    from private.redacted_events(owner_id, viewer_tier, range_start, range_end) r;
end;
$$;

comment on function public.events_for_viewer(uuid, timestamptz, timestamptz) is
  'The only way to read another user''s events (D41). Applies resolve_tier and the redaction path; the viewer is always the caller.';

revoke all on function public.events_for_viewer(uuid, timestamptz, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.events_for_viewer(uuid, timestamptz, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- Privileges and RLS.
--
-- Supabase's default grants give anon and authenticated ALL on these tables
-- (including TRUNCATE, which RLS does not cover), so start from nothing and
-- grant back only what each table needs. anon gets nothing on any table.
-- ---------------------------------------------------------------------------
alter table public.friendships enable row level security;
alter table public.blocks enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.visibility_rules enable row level security;
alter table public.sources enable row level security;
alter table public.events enable row level security;

revoke all on table
  public.friendships,
  public.blocks,
  public.groups,
  public.group_members,
  public.visibility_rules,
  public.sources,
  public.events
from anon, authenticated;

-- Connection tables: read-only for clients. Writes come from the WF-042/043/
-- 045/047 security definer functions, so a client can't add itself to a
-- group, accept on someone's behalf, or grant itself a tier.
grant select on table public.friendships, public.blocks, public.groups, public.group_members
  to authenticated;

-- Both parties see a friendship or request (the recipient needs it for the inbox).
create policy friendships_select_party on public.friendships
  for select to authenticated
  using ((select public.current_user_id()) in (user_a, user_b));

-- Only the blocker sees a block.
create policy blocks_select_blocker on public.blocks
  for select to authenticated
  using (blocker_id = (select public.current_user_id()));

-- A user sees their own memberships only. Member lists of a group (with block
-- filtering) are left to a WF-043 definer function, so blocks can be applied
-- to them.
create policy group_members_select_own on public.group_members
  for select to authenticated
  using (user_id = (select public.current_user_id()));

-- A user sees the groups they belong to.
create policy groups_select_member on public.groups
  for select to authenticated
  using (
    exists (
      select 1
      from public.group_members m
      where m.group_id = groups.id
        and m.user_id = (select public.current_user_id())
    )
  );

-- Visibility rules: the owner can read theirs and change the tier of an
-- existing rule (FR-VIS-2). Creating rules happens with the connection
-- (WF-042/045) and deleting them with its removal (WF-047).
grant select, update (tier) on table public.visibility_rules to authenticated;

create policy visibility_rules_select_own on public.visibility_rules
  for select to authenticated
  using (owner_id = (select public.current_user_id()));

create policy visibility_rules_update_own on public.visibility_rules
  for update to authenticated
  using (owner_id = (select public.current_user_id()))
  with check (owner_id = (select public.current_user_id()));

-- Sources and events: owners read and write their own rows directly (D41).
grant select, insert, update, delete on table public.sources, public.events to authenticated;

create policy sources_select_own on public.sources
  for select to authenticated
  using (user_id = (select public.current_user_id()));
create policy sources_insert_own on public.sources
  for insert to authenticated
  with check (user_id = (select public.current_user_id()));
create policy sources_update_own on public.sources
  for update to authenticated
  using (user_id = (select public.current_user_id()))
  with check (user_id = (select public.current_user_id()));
create policy sources_delete_own on public.sources
  for delete to authenticated
  using (user_id = (select public.current_user_id()));

create policy events_select_own on public.events
  for select to authenticated
  using (user_id = (select public.current_user_id()));
create policy events_insert_own on public.events
  for insert to authenticated
  with check (user_id = (select public.current_user_id()));
create policy events_update_own on public.events
  for update to authenticated
  using (user_id = (select public.current_user_id()))
  with check (user_id = (select public.current_user_id()));
create policy events_delete_own on public.events
  for delete to authenticated
  using (user_id = (select public.current_user_id()));

-- ============================================================================================
-- 20261001100000_rate_limits.sql
-- ============================================================================================

-- NFR-SEC-9: rate limits for abusable writes (PRD §9 `rateLimits`, §8.2
-- "Rate limiting: a Postgres counter table checked inside the write
-- functions").
--
-- Fixed-window counters, one row per (user, action, window). Write functions
-- call `private.consume_rate_limit(user, action, max_count, window)` inside
-- their own transaction, before doing the write. Because the counter lives in
-- the caller's transaction, an attempt that fails later (and rolls back) does
-- not use up the allowance: the limit counts writes that actually happened.
--
-- Reuse (groups/invites WF-043/045, parses WF-035, pings WF-094): pick an
-- action name and call the helper from your security definer function, e.g.
--   perform private.consume_rate_limit(me, 'ping', 30, interval '1 day');
--   perform private.consume_rate_limit(me, 'ping_to:' || target, 3, interval '1 hour');
-- An action is a lowercase name, optionally followed by `:` and a scope such
-- as a target id, for per-target limits.
--
-- Windows are aligned to multiples of their length since 2000-01-01 00:00 UTC
-- (so daily windows start at 00:00 UTC, 19:00 in Jamaica). A fixed window can
-- let up to 2 x max_count through around a window boundary; that is accepted
-- for the MVP (PRD §8.2 chose fixed windows).

-- ---------------------------------------------------------------------------
-- rate_limits
-- ---------------------------------------------------------------------------
create table public.rate_limits (
  user_id uuid not null references public.users (id) on delete cascade,
  action text not null check (
    char_length(action) <= 100 and action ~ '^[a-z][a-z0-9_]*(:[A-Za-z0-9_-]+)?$'
  ),
  window_start timestamptz not null,
  -- Not in the PRD's column list: stored so cleanup knows when a row is dead
  -- (windows differ per action) and so errors can say when to retry.
  window_end timestamptz not null,
  count integer not null default 0 check (count >= 0),
  created_at timestamptz not null default now(),
  constraint rate_limits_pkey primary key (user_id, action, window_start),
  constraint rate_limits_window_ordered check (window_end > window_start)
);
create index rate_limits_window_end_idx on public.rate_limits (window_end);

comment on table public.rate_limits is
  'Fixed-window counters for abusable writes (NFR-SEC-9). Written only by private.consume_rate_limit; clients cannot read or write it.';

-- Clients get nothing: not their own counters either (a user doesn't need to
-- read them, and errors say when to retry). RLS is on with no policies, so
-- even a stray grant would expose no rows. service_role keeps Supabase's
-- default access (server-side only, bypasses RLS) like every other table.
alter table public.rate_limits enable row level security;
revoke all on table public.rate_limits from anon, authenticated;

-- ---------------------------------------------------------------------------
-- private.try_consume_rate_limit(user_id, action, max_count, window): uses one
-- unit of `user_id`'s allowance for `action` in the current window. Returns
-- true if the attempt is within `max_count` per `window`, false (and records
-- nothing) if the limit is already reached.
--
-- Concurrency-safe: see the upsert below.
--
-- Runs with the privileges of the security definer function that calls it.
-- ---------------------------------------------------------------------------
create function private.try_consume_rate_limit(
  p_user_id uuid,
  p_action text,
  p_max_count integer,
  p_window interval
) returns boolean
language plpgsql
volatile
set search_path = ''
as $$
declare
  w_start timestamptz;
  new_count integer;
begin
  if p_user_id is null or p_action is null then
    raise exception 'rate limit needs a user and an action' using errcode = '22004';
  end if;
  if p_max_count is null or p_max_count < 1 then
    raise exception 'rate limit max_count must be at least 1' using errcode = '22023';
  end if;
  if p_window is null or p_window <= interval '0' or p_window > interval '366 days' then
    raise exception 'rate limit window must be between 0 and 366 days' using errcode = '22023';
  end if;

  w_start := pg_catalog.date_bin(p_window, pg_catalog.now(), timestamptz '2000-01-01 00:00:00+00');

  -- The conditional upsert only increments while under the limit. ON CONFLICT
  -- locks the existing row and evaluates the WHERE on its latest version, so
  -- concurrent callers are serialised and can't both take the last unit.
  insert into public.rate_limits as r (user_id, action, window_start, window_end, count)
  values (p_user_id, p_action, w_start, w_start + p_window, 1)
  on conflict (user_id, action, window_start)
    do update set count = r.count + 1
    where r.count < p_max_count
  returning r.count into new_count;

  return new_count is not null;
end;
$$;

revoke all on function private.try_consume_rate_limit(uuid, text, integer, interval) from public;

comment on function private.try_consume_rate_limit(uuid, text, integer, interval) is
  'NFR-SEC-9: uses one unit of a fixed-window allowance; false (and nothing recorded) when the limit is reached.';

-- ---------------------------------------------------------------------------
-- private.consume_rate_limit(user_id, action, max_count, window): as above,
-- but raises when the limit is reached, which aborts the calling write.
--
-- Error: SQLSTATE PT429, message 'Too many attempts'. PostgREST turns a `PTxyz`
-- SQLSTATE into HTTP status xyz, so clients get HTTP 429 with code PT429
-- (map it to "Slow down"). The detail is JSON:
--   {"action": "<name without scope>", "limit": n, "retry_at": "<timestamptz>"}
-- The action's scope (e.g. a target user id) is left out of the detail.
-- ---------------------------------------------------------------------------
create function private.consume_rate_limit(
  p_user_id uuid,
  p_action text,
  p_max_count integer,
  p_window interval
) returns void
language plpgsql
volatile
set search_path = ''
as $$
begin
  if not private.try_consume_rate_limit(p_user_id, p_action, p_max_count, p_window) then
    raise exception 'Too many attempts'
      using
        errcode = 'PT429',
        detail = pg_catalog.jsonb_build_object(
          'action', pg_catalog.split_part(p_action, ':', 1),
          'limit', p_max_count,
          'retry_at',
          pg_catalog.date_bin(p_window, pg_catalog.now(), timestamptz '2000-01-01 00:00:00+00')
            + p_window
        )::text,
        hint = 'Slow down and try again later.';
  end if;
end;
$$;

revoke all on function private.consume_rate_limit(uuid, text, integer, interval) from public;

comment on function private.consume_rate_limit(uuid, text, integer, interval) is
  'NFR-SEC-9: uses one unit of a fixed-window allowance, or raises SQLSTATE PT429 (HTTP 429) when the limit is reached.';

-- ---------------------------------------------------------------------------
-- private.purge_expired_rate_limits(): deletes counters whose window has
-- ended; returns how many rows it deleted. To be scheduled by the retention
-- cron (WF-037); until then counters just accumulate harmlessly.
-- ---------------------------------------------------------------------------
create function private.purge_expired_rate_limits() returns integer
language sql
volatile
set search_path = ''
as $$
  with deleted as (
    delete from public.rate_limits r
    where r.window_end <= pg_catalog.now()
    returning 1
  )
  select count(*)::integer from deleted
$$;

revoke all on function private.purge_expired_rate_limits() from public;

comment on function private.purge_expired_rate_limits() is
  'Deletes rate-limit counters whose window has ended (for the WF-037 cron). Returns the number deleted.';

-- ============================================================================================
-- 20261001100100_profiles_and_handles.sql
-- ============================================================================================

-- WF-040: profiles and handles (FR-AUTH-2, FR-SOC-6, NFR-SEC-2, NFR-SEC-9, D41, D43).
--
--   * Handle rules as CHECK constraints on users.handle, mirroring
--     `Handle` in @whosfree/shared (packages/shared/src/handles.ts).
--   * public.set_handle(): the only way to set, change or clear a handle.
--   * public.get_profile() and public.find_user_by_handle(): another user's
--     public profile (id, name, handle, avatar), block-aware.
--
-- Display name and avatar are already client-updatable (WF-003 column grant).
--
-- Error codes raised by our functions (see packages/backend/src/errors.ts):
--   WF001  the token has no users row yet (sign-up not finished)
--   WF101  handle_invalid  (length, characters)
--   WF102  handle_reserved
--   WF103  handle_taken
--   PT429  rate limited (HTTP 429 through PostgREST)

-- ---------------------------------------------------------------------------
-- Handle rules. NULL = no handle. The unique index users_handle_lower_key
-- (WF-003) makes handles unique ignoring case; the case the user typed is
-- kept for display.
--
--   * 3–30 characters;
--   * ASCII letters, digits and underscores, starting with a letter (the
--     octet_length check guarantees ASCII whatever the regex engine thinks a
--     letter range is, so look-alike Unicode can't impersonate a handle);
--   * not a reserved word (the list must match RESERVED_HANDLES in
--     @whosfree/shared exactly; test/profiles.test.ts compares them), and not
--     containing "whosfree".
--
-- Inline expressions rather than a helper function: CHECK constraints run
-- as the updating role, which has no access to the private schema.
-- ---------------------------------------------------------------------------
alter table public.users drop constraint users_handle_check;

alter table public.users
  add constraint users_handle_format check (
    handle is null or (
      char_length(handle) between 3 and 30
      and octet_length(handle) = char_length(handle)
      and handle ~ '^[A-Za-z][A-Za-z0-9_]*$'
    )
  ),
  add constraint users_handle_not_reserved check (
    handle is null or (
      strpos(lower(handle), 'whosfree') = 0
      and lower(handle) <> all (array[
        'about', 'account', 'accounts', 'admin', 'administrator', 'anon', 'anonymous',
        'api', 'app', 'auth', 'blog', 'calendar', 'contact', 'dashboard', 'email',
        'everyone', 'explore', 'friend', 'friends', 'group', 'groups', 'help', 'here',
        'home', 'i', 'import', 'inbox', 'invite', 'invites', 'legal', 'login', 'logout',
        'mail', 'me', 'mod', 'moderator', 'news', 'notifications', 'now', 'null',
        'official', 'onboarding', 'ping', 'pings', 'privacy', 'profile', 'register',
        'root', 'schedule', 'search', 'security', 'settings', 'share', 'sign_in',
        'sign_up', 'signin', 'signup', 'staff', 'status', 'support', 'system', 'team',
        'terms', 'undefined', 'upload', 'user', 'users', 'webhook', 'webhooks',
        'whosfree', 'www'
      ]::text[])
    )
  );

-- ---------------------------------------------------------------------------
-- private.require_user(): the caller's users.id, or raise WF001 when the
-- token has no users row. For write functions; read functions return nothing
-- instead (like events_for_viewer).
-- ---------------------------------------------------------------------------
create function private.require_user() returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  me uuid := public.current_user_id();
begin
  if me is null then
    raise exception 'No account for this sign-in'
      using errcode = 'WF001', hint = 'Finish signing up first.';
  end if;
  return me;
end;
$$;

revoke all on function private.require_user() from public;

-- ---------------------------------------------------------------------------
-- private.normalize_handle(text): what the user typed, without surrounding
-- whitespace or one leading `@`; null when nothing is left. Same as
-- normalizeHandleInput in @whosfree/shared.
-- ---------------------------------------------------------------------------
create function private.normalize_handle(raw text) returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(
    pg_catalog.regexp_replace(pg_catalog.regexp_replace(raw, '^\s+|\s+$', '', 'g'), '^@', ''),
    ''
  )
$$;

revoke all on function private.normalize_handle(text) from public;

-- ---------------------------------------------------------------------------
-- private.is_blocked(a, b): a block in either direction (FR-SOC-6, D43).
-- ---------------------------------------------------------------------------
create function private.is_blocked(a uuid, b uuid) returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.blocks bl
    where (bl.blocker_id = a and bl.blocked_id = b)
       or (bl.blocker_id = b and bl.blocked_id = a)
  )
$$;

revoke all on function private.is_blocked(uuid, uuid) from public;

-- ---------------------------------------------------------------------------
-- private.relationship(me, other): how `other` relates to `me`:
-- 'self', 'friend', 'request_sent' (me -> other, pending),
-- 'request_received' (other -> me, pending) or 'none'. Says nothing about
-- blocks: callers filter blocked pairs out before calling it.
-- ---------------------------------------------------------------------------
create function private.relationship(me uuid, other uuid) returns text
language sql
stable
set search_path = ''
as $$
  select case
    when me = other then 'self'
    else coalesce(
      (
        select case
          when f.status = 'accepted' then 'friend'
          when f.requested_by = me then 'request_sent'
          else 'request_received'
        end
        from public.friendships f
        where f.user_a = least(me, other) and f.user_b = greatest(me, other)
      ),
      'none'
    )
  end
$$;

revoke all on function private.relationship(uuid, uuid) from public;

-- ---------------------------------------------------------------------------
-- private.visible_profile(viewer, target): the public profile of `target` as
-- `viewer` may see it, or no row when there is no such user or a block in
-- either direction. The single place other users' profile fields are read:
-- every function that returns another user's name, handle or avatar goes
-- through this or applies private.is_blocked itself.
--
-- A public profile is id, name, handle and avatar: what someone needs to
-- recognise a person before sending a friend request. Nothing else (no
-- timezone, sharing state, age or consent fields) is ever returned.
-- ---------------------------------------------------------------------------
create function private.visible_profile(viewer uuid, target uuid)
returns table (id uuid, name text, handle text, avatar_url text, relationship text)
language sql
stable
set search_path = ''
as $$
  select u.id, u.name, u.handle, u.avatar_url, private.relationship(viewer, u.id)
  from public.users u
  where viewer is not null
    and u.id = target
    and not private.is_blocked(viewer, u.id)
$$;

revoke all on function private.visible_profile(uuid, uuid) from public;

-- ---------------------------------------------------------------------------
-- public.set_handle(handle): sets, changes or clears (null or '') the
-- caller's handle; returns the stored handle. Accepts `@kemar` and
-- surrounding spaces. Errors: WF001, WF101 (invalid), WF102 (reserved),
-- WF103 (taken, ignoring case, including a race with another user).
--
-- Rate limit: 10 successful changes per day ('handle_change'). Failed
-- attempts roll back and don't count. Setting the same handle again is a
-- no-op and costs nothing.
-- ---------------------------------------------------------------------------
create function public.set_handle(handle text) returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := private.require_user();
  new_handle text := private.normalize_handle(set_handle.handle);
  current_handle text;
  failed_constraint text;
begin
  select u.handle into current_handle from public.users u where u.id = me;
  if current_handle is not distinct from new_handle then
    return new_handle;
  end if;

  perform private.consume_rate_limit(me, 'handle_change', 10, interval '1 day');

  begin
    update public.users u set handle = new_handle where u.id = me;
  exception
    when unique_violation then
      raise exception 'That handle is taken' using errcode = 'WF103';
    when check_violation then
      get stacked diagnostics failed_constraint = constraint_name;
      if failed_constraint = 'users_handle_not_reserved' then
        raise exception 'That handle is reserved' using errcode = 'WF102';
      end if;
      raise exception 'Handles are 3–30 letters, numbers or underscores, starting with a letter'
        using errcode = 'WF101';
  end;

  return new_handle;
end;
$$;

comment on function public.set_handle(text) is
  'WF-040: sets, changes or clears (null) the caller''s handle. Errors WF101 invalid, WF102 reserved, WF103 taken, PT429 rate limited.';

revoke all on function public.set_handle(text) from public, anon, authenticated, service_role;
grant execute on function public.set_handle(text) to authenticated;

-- ---------------------------------------------------------------------------
-- public.get_profile(user_id): another user's public profile by id (e.g. from
-- a QR code or a list), with how they relate to the caller. No row when the
-- user doesn't exist, is blocked, or has blocked the caller: these look the
-- same, so a blocked user can't tell (FR-SOC-6). The caller's own profile
-- comes back with relationship 'self'. Ids are unguessable, so this is not
-- rate-limited.
-- ---------------------------------------------------------------------------
create function public.get_profile(user_id uuid)
returns table (id uuid, name text, handle text, avatar_url text, relationship text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.name, p.handle, p.avatar_url, p.relationship
  from private.visible_profile(public.current_user_id(), get_profile.user_id) p
$$;

comment on function public.get_profile(uuid) is
  'WF-040: another user''s public profile (id, name, handle, avatar) and relationship; nothing if blocked either way.';

revoke all on function public.get_profile(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_profile(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- public.find_user_by_handle(lookup): exact handle lookup (ignoring case,
-- `@` optional) for adding a friend. Same result shape and block rules as
-- get_profile. No prefix or name search, so users can't be listed.
--
-- Handles are guessable, so lookups are rate-limited to stop enumeration:
-- 100 per hour ('handle_lookup'), counted whether or not a user is found.
-- Call it when the user submits, not on every keystroke.
-- ---------------------------------------------------------------------------
create function public.find_user_by_handle(lookup text)
returns table (id uuid, name text, handle text, avatar_url text, relationship text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := public.current_user_id();
  wanted text := pg_catalog.lower(private.normalize_handle(find_user_by_handle.lookup));
begin
  if me is null then
    return;
  end if;

  perform private.consume_rate_limit(me, 'handle_lookup', 100, interval '1 hour');

  if wanted is null then
    return;
  end if;

  return query
    select p.id, p.name, p.handle, p.avatar_url, p.relationship
    from public.users u
    cross join lateral private.visible_profile(me, u.id) p
    where u.handle is not null
      and pg_catalog.lower(u.handle) = wanted;
end;
$$;

comment on function public.find_user_by_handle(text) is
  'WF-040: exact, case-insensitive handle lookup; nothing if blocked either way. Rate-limited (100/hour).';

revoke all on function public.find_user_by_handle(text) from public, anon, authenticated, service_role;
grant execute on function public.find_user_by_handle(text) to authenticated;

-- ============================================================================================
-- 20261001100200_friend_requests.sql
-- ============================================================================================

-- WF-042: friend requests with tier choice (FR-SOC-1, FR-SOC-6, FR-VIS-1,
-- FR-VIS-2, NFR-SEC-2, NFR-SEC-9, D2, D20, D41, D43).
--
-- Clients still can't write friendships or visibility_rules directly (only
-- the existing `tier` update on their own rules, FR-VIS-2). Every change to
-- the friend graph goes through these security definer functions:
--
--   send_friend_request(user_id, tier)            by id (QR code, profile page)
--   send_friend_request_by_handle(handle, tier)   by handle
--   accept_friend_request(user_id, tier)
--   decline_friend_request(user_id)
--   cancel_friend_request(user_id)
--   list_friend_requests()
--   list_friends()
--
-- Tier choice (FR-VIS-1, D20): each side picks what the other will see
-- before the connection exists, T1 by default. The sender's choice is stored
-- as their friend visibility rule when they send; resolve_tier ignores it
-- until the friendship is accepted. The recipient's choice is stored when
-- they accept, in the same transaction that accepts, so an accepted
-- friendship always has both rules.
--
-- Mutual requests: if B sends a request to A while A's request to B is still
-- pending, the friendship is accepted straight away with each side's chosen
-- tier. Both have said yes and both have picked a tier, which is everything
-- accepting would add; an error would only make B find A's request and
-- accept it, choosing the same tier again.
--
-- Blocks (FR-SOC-6): a request to or from someone who has blocked you fails
-- exactly as for a user that doesn't exist (WF201), so the blocked person
-- can't tell. A request to someone you have blocked fails with WF206 (only
-- the blocker ever sees that). Lists leave out anyone blocked either way.
--
-- Concurrency: every function that changes a pair takes a transaction-level
-- advisory lock on the pair (private.lock_pair) before reading its state, so
-- send/accept/decline/cancel/unfriend/block on the same two people run one
-- after the other and each sees the previous one's result. (Functions are
-- volatile, so each statement after the lock takes a fresh snapshot under
-- READ COMMITTED.)
--
-- Rate limits (NFR-SEC-9), counted only for requests that are created:
--   'friend_request'            20 per day per sender (auto-accepts count too)
--   'friend_request_to:<id>'     3 per 7 days per sender and recipient, so a
--                                declined request can't be re-sent over and over
--
-- Errors (packages/backend/src/errors.ts):
--   WF001 no account; WF201 user not found (or blocked either way);
--   WF202 cannot friend yourself; WF203 already friends;
--   WF204 request already sent; WF205 no pending request to accept;
--   WF206 you have blocked this user; PT429 rate limited;
--   22023 tier not 1–3 (a caller bug).

-- ---------------------------------------------------------------------------
-- private.lock_pair(a, b): serialises changes to one pair of users for the
-- rest of the transaction. The key doesn't depend on argument order.
-- ---------------------------------------------------------------------------
create function private.lock_pair(a uuid, b uuid) returns void
language sql
volatile
set search_path = ''
as $$
  select pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'whosfree.friend_pair:' || least(a, b)::text || ':' || greatest(a, b)::text,
      0
    )
  )
$$;

revoke all on function private.lock_pair(uuid, uuid) from public;

-- ---------------------------------------------------------------------------
-- private.check_tier(tier): the tier as smallint, or 22023 if it isn't 1–3.
-- ---------------------------------------------------------------------------
create function private.check_tier(tier integer) returns smallint
language plpgsql
immutable
set search_path = ''
as $$
begin
  if tier is null or tier not between 1 and 3 then
    raise exception 'tier must be 1, 2 or 3' using errcode = '22023';
  end if;
  return tier::smallint;
end;
$$;

revoke all on function private.check_tier(integer) from public;

-- ---------------------------------------------------------------------------
-- private.set_friend_rule(owner, friend, tier): the tier `owner` grants
-- `friend`, created or replaced.
-- ---------------------------------------------------------------------------
create function private.set_friend_rule(owner uuid, friend uuid, tier smallint) returns void
language sql
volatile
set search_path = ''
as $$
  insert into public.visibility_rules (owner_id, target_type, target_id, tier)
  values (owner, 'friend', friend, tier)
  on conflict (owner_id, target_type, target_id) do update set tier = excluded.tier
$$;

revoke all on function private.set_friend_rule(uuid, uuid, smallint) from public;

-- ---------------------------------------------------------------------------
-- private.delete_friend_rules(a, b): both people's friend rules for each
-- other. A leftover rule grants nothing (resolve_tier needs an accepted
-- friendship), but it would silently come back if they became friends again.
-- ---------------------------------------------------------------------------
create function private.delete_friend_rules(a uuid, b uuid) returns void
language sql
volatile
set search_path = ''
as $$
  delete from public.visibility_rules r
  where r.target_type = 'friend'
    and ((r.owner_id = a and r.target_id = b) or (r.owner_id = b and r.target_id = a))
$$;

revoke all on function private.delete_friend_rules(uuid, uuid) from public;

-- ---------------------------------------------------------------------------
-- private.send_friend_request(me, target, tier): the shared body of the two
-- public send functions. Returns 'pending' (request created) or 'accepted'
-- (target had already asked me, so we are now friends).
--
-- Check order matters: the rate limit comes first so every attempt is
-- treated the same; "not found" and "they blocked you" raise the same error
-- at the same point.
-- ---------------------------------------------------------------------------
create function private.send_friend_request(me uuid, target uuid, tier integer) returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  my_tier smallint := private.check_tier(tier);
  existing public.friendships%rowtype;
begin
  perform private.consume_rate_limit(me, 'friend_request', 20, interval '1 day');

  if target is null or not exists (select 1 from public.users u where u.id = target) then
    raise exception 'User not found' using errcode = 'WF201';
  end if;
  if target = me then
    raise exception 'You can''t send a friend request to yourself' using errcode = 'WF202';
  end if;

  perform private.lock_pair(me, target);

  -- After the lock, so a block committed just before can't be missed.
  if exists (
    select 1 from public.blocks bl where bl.blocker_id = me and bl.blocked_id = target
  ) then
    raise exception 'You have blocked this user' using errcode = 'WF206';
  end if;
  if exists (
    select 1 from public.blocks bl where bl.blocker_id = target and bl.blocked_id = me
  ) then
    raise exception 'User not found' using errcode = 'WF201';
  end if;

  select f.* into existing
  from public.friendships f
  where f.user_a = least(me, target) and f.user_b = greatest(me, target);

  if found then
    if existing.status = 'accepted' then
      raise exception 'You are already friends' using errcode = 'WF203';
    end if;
    if existing.requested_by = me then
      raise exception 'Friend request already sent' using errcode = 'WF204';
    end if;
    -- They asked me first: accept, with my tier for them and theirs as chosen.
    update public.friendships f set status = 'accepted' where f.id = existing.id;
    perform private.set_friend_rule(me, target, my_tier);
    insert into public.visibility_rules (owner_id, target_type, target_id)
    values (target, 'friend', me)
    on conflict (owner_id, target_type, target_id) do nothing;
    return 'accepted';
  end if;

  perform private.consume_rate_limit(me, 'friend_request_to:' || target::text, 3, interval '7 days');

  insert into public.friendships (user_a, user_b, status, requested_by)
  values (least(me, target), greatest(me, target), 'pending', me);
  perform private.set_friend_rule(me, target, my_tier);
  return 'pending';
end;
$$;

revoke all on function private.send_friend_request(uuid, uuid, integer) from public;

-- ---------------------------------------------------------------------------
-- public.send_friend_request(user_id, tier): request by user id. `tier` is
-- what the recipient will see of the caller once accepted (default T1).
-- ---------------------------------------------------------------------------
create function public.send_friend_request(user_id uuid, tier integer default 1) returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  return private.send_friend_request(
    private.require_user(),
    send_friend_request.user_id,
    send_friend_request.tier
  );
end;
$$;

comment on function public.send_friend_request(uuid, integer) is
  'WF-042: friend request by user id with the tier the recipient will see. Returns pending, or accepted if they had already asked.';

revoke all on function public.send_friend_request(uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.send_friend_request(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- public.send_friend_request_by_handle(handle, tier): as above, by exact
-- handle (ignoring case, `@` optional). An unknown or malformed handle is
-- WF201, like a blocked one.
-- ---------------------------------------------------------------------------
create function public.send_friend_request_by_handle(handle text, tier integer default 1)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := private.require_user();
  wanted text := pg_catalog.lower(private.normalize_handle(send_friend_request_by_handle.handle));
  target uuid;
begin
  select u.id into target
  from public.users u
  where u.handle is not null and pg_catalog.lower(u.handle) = wanted;

  return private.send_friend_request(me, target, send_friend_request_by_handle.tier);
end;
$$;

comment on function public.send_friend_request_by_handle(text, integer) is
  'WF-042: friend request by handle with the tier the recipient will see. Returns pending, or accepted if they had already asked.';

revoke all on function public.send_friend_request_by_handle(text, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.send_friend_request_by_handle(text, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- public.accept_friend_request(user_id, tier): accepts the pending request
-- that `user_id` sent the caller. `tier` is what the requester will see of
-- the caller (default T1). Creates the caller's friend rule and makes sure
-- the requester's exists (T1 if somehow missing), in the same transaction.
-- WF205 if there is no such pending request (withdrawn, declined, already
-- accepted, or removed by a block).
-- ---------------------------------------------------------------------------
create function public.accept_friend_request(user_id uuid, tier integer default 1) returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := private.require_user();
  requester uuid := accept_friend_request.user_id;
  my_tier smallint := private.check_tier(accept_friend_request.tier);
  request_id uuid;
begin
  if requester is null or requester = me then
    raise exception 'No pending friend request from this user' using errcode = 'WF205';
  end if;

  perform private.lock_pair(me, requester);

  select f.id into request_id
  from public.friendships f
  where f.user_a = least(me, requester)
    and f.user_b = greatest(me, requester)
    and f.status = 'pending'
    and f.requested_by = requester;

  if request_id is null or private.is_blocked(me, requester) then
    raise exception 'No pending friend request from this user' using errcode = 'WF205';
  end if;

  update public.friendships f set status = 'accepted' where f.id = request_id;
  perform private.set_friend_rule(me, requester, my_tier);
  insert into public.visibility_rules (owner_id, target_type, target_id)
  values (requester, 'friend', me)
  on conflict (owner_id, target_type, target_id) do nothing;
end;
$$;

comment on function public.accept_friend_request(uuid, integer) is
  'WF-042: accepts a pending request from user_id, choosing the tier they will see (default 1). Creates both friend rules.';

revoke all on function public.accept_friend_request(uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.accept_friend_request(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- public.decline_friend_request(user_id): deletes the pending request
-- `user_id` sent the caller, and the requester's pending tier choice. The
-- requester's view of it just disappears (as it would after a block).
-- Idempotent: nothing to decline is not an error.
-- ---------------------------------------------------------------------------
create function public.decline_friend_request(user_id uuid) returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := private.require_user();
  requester uuid := decline_friend_request.user_id;
begin
  if requester is null or requester = me then
    return;
  end if;

  perform private.lock_pair(me, requester);

  delete from public.friendships f
  where f.user_a = least(me, requester)
    and f.user_b = greatest(me, requester)
    and f.status = 'pending'
    and f.requested_by = requester;

  if found then
    perform private.delete_friend_rules(me, requester);
  end if;
end;
$$;

comment on function public.decline_friend_request(uuid) is
  'WF-042: declines (deletes) the pending request from user_id. Idempotent.';

revoke all on function public.decline_friend_request(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.decline_friend_request(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- public.cancel_friend_request(user_id): withdraws the caller's pending
-- request to `user_id` and the caller's pending tier choice. Idempotent.
-- Does not refund the rate limit.
-- ---------------------------------------------------------------------------
create function public.cancel_friend_request(user_id uuid) returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := private.require_user();
  recipient uuid := cancel_friend_request.user_id;
begin
  if recipient is null or recipient = me then
    return;
  end if;

  perform private.lock_pair(me, recipient);

  delete from public.friendships f
  where f.user_a = least(me, recipient)
    and f.user_b = greatest(me, recipient)
    and f.status = 'pending'
    and f.requested_by = me;

  if found then
    perform private.delete_friend_rules(me, recipient);
  end if;
end;
$$;

comment on function public.cancel_friend_request(uuid) is
  'WF-042: withdraws the caller''s pending request to user_id. Idempotent.';

revoke all on function public.cancel_friend_request(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.cancel_friend_request(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- public.list_friend_requests(): the caller's pending requests, newest first,
-- with the other person's public profile. `direction` is 'incoming' or
-- 'outgoing'; `tier` is the tier the caller chose for an outgoing request
-- (null for incoming: the caller chooses when accepting). Leaves out anyone
-- blocked either way.
-- ---------------------------------------------------------------------------
create function public.list_friend_requests()
returns table (
  user_id uuid,
  name text,
  handle text,
  avatar_url text,
  direction text,
  tier smallint,
  requested_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    other.id,
    other.name,
    other.handle,
    other.avatar_url,
    case when f.requested_by = me.id then 'outgoing' else 'incoming' end,
    case when f.requested_by = me.id then r.tier end,
    f.created_at
  from (select public.current_user_id() as id) me
  join public.friendships f
    on me.id in (f.user_a, f.user_b)
   and f.status = 'pending'
  join public.users other
    on other.id = case when f.user_a = me.id then f.user_b else f.user_a end
  left join public.visibility_rules r
    on r.owner_id = me.id
   and r.target_type = 'friend'
   and r.target_id = other.id
  where not private.is_blocked(me.id, other.id)
  order by f.created_at desc, other.id
$$;

comment on function public.list_friend_requests() is
  'WF-042: the caller''s pending incoming and outgoing requests with public profiles; blocked users left out.';

revoke all on function public.list_friend_requests()
  from public, anon, authenticated, service_role;
grant execute on function public.list_friend_requests() to authenticated;

-- ---------------------------------------------------------------------------
-- public.list_friends(): the caller's accepted friends, by name, with their
-- public profile and the tier the caller grants each one (the caller's own
-- rule; change it with an update of visibility_rules.tier, FR-VIS-2).
-- Leaves out anyone blocked either way.
-- ---------------------------------------------------------------------------
create function public.list_friends()
returns table (user_id uuid, name text, handle text, avatar_url text, tier smallint)
language sql
stable
security definer
set search_path = ''
as $$
  select other.id, other.name, other.handle, other.avatar_url, r.tier
  from (select public.current_user_id() as id) me
  join public.friendships f
    on me.id in (f.user_a, f.user_b)
   and f.status = 'accepted'
  join public.users other
    on other.id = case when f.user_a = me.id then f.user_b else f.user_a end
  left join public.visibility_rules r
    on r.owner_id = me.id
   and r.target_type = 'friend'
   and r.target_id = other.id
  where not private.is_blocked(me.id, other.id)
  order by other.name, other.id
$$;

comment on function public.list_friends() is
  'WF-042: the caller''s friends with public profiles and the tier the caller grants each; blocked users left out.';

revoke all on function public.list_friends() from public, anon, authenticated, service_role;
grant execute on function public.list_friends() to authenticated;

-- ============================================================================================
-- 20261001100300_block_unblock_unfriend.sql
-- ============================================================================================

-- WF-047 (friends half): unfriend, block, unblock (FR-SOC-6, NFR-SEC-2, D41,
-- D43). Leaving a group is WF-043/047's group half and lives elsewhere.
--
--   unfriend(user_id)       ends an accepted friendship
--   block_user(user_id)     blocks, and ends any friendship or request
--   unblock_user(user_id)   lifts the caller's own block
--   list_blocked_users()    the people the caller has blocked
--
-- Visibility is revoked in the same transaction: resolve_tier needs an
-- accepted friendship (or a shared group) and returns nothing across a block,
-- so the next events_for_viewer call already sees the change. Both people's
-- friend rules are deleted too, so a later re-friend starts from the tiers
-- chosen then, not from old ones.
--
-- Blocking is invisible to the blocked person (FR-SOC-6): the friendship or
-- request row they could see is deleted, exactly as an unfriend, decline or
-- cancel would delete it, and the blocks row is readable by the blocker only.
-- The blocked person can no longer find or look up the blocker
-- (get_profile / find_user_by_handle / send_* treat them as missing).
--
-- Removals are idempotent (repeating one, or removing something that is
-- already gone, is not an error), and none of them is rate-limited: blocking
-- and unfriending must always work, especially for someone being harassed.
-- They take the same pair lock as the request functions (WF-042), so a block
-- can't interleave with a request or accept between the same two people.

-- ---------------------------------------------------------------------------
-- public.unfriend(user_id): ends the caller's accepted friendship with
-- `user_id` and deletes both friend rules. Pending requests are untouched
-- (use decline_friend_request / cancel_friend_request).
-- ---------------------------------------------------------------------------
create function public.unfriend(user_id uuid) returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := private.require_user();
  friend uuid := unfriend.user_id;
begin
  if friend is null or friend = me then
    return;
  end if;

  perform private.lock_pair(me, friend);

  delete from public.friendships f
  where f.user_a = least(me, friend)
    and f.user_b = greatest(me, friend)
    and f.status = 'accepted';

  if found then
    perform private.delete_friend_rules(me, friend);
  end if;
end;
$$;

comment on function public.unfriend(uuid) is
  'WF-047: ends an accepted friendship and deletes both friend rules; visibility is revoked immediately. Idempotent.';

revoke all on function public.unfriend(uuid) from public, anon, authenticated, service_role;
grant execute on function public.unfriend(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- public.block_user(user_id): blocks `user_id`, and deletes any friendship or
-- pending request between the two (either direction) and both friend rules.
-- Errors: WF001, WF201 (no such user), WF202 (yourself). Blocking someone
-- who has already blocked you works the same and reveals nothing.
-- Group memberships are not touched (resolve_tier already gives nothing
-- across a block; group member lists must filter blocks, WF-043).
-- ---------------------------------------------------------------------------
create function public.block_user(user_id uuid) returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := private.require_user();
  target uuid := block_user.user_id;
begin
  if target is null or not exists (select 1 from public.users u where u.id = target) then
    raise exception 'User not found' using errcode = 'WF201';
  end if;
  if target = me then
    raise exception 'You can''t block yourself' using errcode = 'WF202';
  end if;

  perform private.lock_pair(me, target);

  insert into public.blocks (blocker_id, blocked_id)
  values (me, target)
  on conflict (blocker_id, blocked_id) do nothing;

  delete from public.friendships f
  where f.user_a = least(me, target) and f.user_b = greatest(me, target);

  perform private.delete_friend_rules(me, target);
end;
$$;

comment on function public.block_user(uuid) is
  'WF-047: blocks a user and ends any friendship or request with them, without telling them. Idempotent.';

revoke all on function public.block_user(uuid) from public, anon, authenticated, service_role;
grant execute on function public.block_user(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- public.unblock_user(user_id): lifts the caller's block of `user_id`. It
-- does not restore the friendship, and a block the other person made stays.
-- Idempotent.
-- ---------------------------------------------------------------------------
create function public.unblock_user(user_id uuid) returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := private.require_user();
  target uuid := unblock_user.user_id;
begin
  if target is null or target = me then
    return;
  end if;

  perform private.lock_pair(me, target);

  delete from public.blocks bl where bl.blocker_id = me and bl.blocked_id = target;
end;
$$;

comment on function public.unblock_user(uuid) is
  'WF-047: lifts the caller''s own block of a user. Does not restore the friendship. Idempotent.';

revoke all on function public.unblock_user(uuid) from public, anon, authenticated, service_role;
grant execute on function public.unblock_user(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- public.list_blocked_users(): the people the caller has blocked, newest
-- first, with their public profile (for the unblock screen). Only the
-- caller's own blocks: whether anyone has blocked the caller is never shown.
-- ---------------------------------------------------------------------------
create function public.list_blocked_users()
returns table (user_id uuid, name text, handle text, avatar_url text, blocked_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select u.id, u.name, u.handle, u.avatar_url, bl.created_at
  from public.blocks bl
  join public.users u on u.id = bl.blocked_id
  where bl.blocker_id = public.current_user_id()
  order by bl.created_at desc, u.id
$$;

comment on function public.list_blocked_users() is
  'WF-047: the users the caller has blocked, with public profiles.';

revoke all on function public.list_blocked_users() from public, anon, authenticated, service_role;
grant execute on function public.list_blocked_users() to authenticated;

-- ============================================================================================
-- 20261001200000_groups.sql
-- ============================================================================================

-- WF-043: groups. Create, edit, transfer the admin role, delete, list my
-- groups, and the member list (PRD §6.3 FR-SOC-2, FR-SOC-5, FR-SOC-7,
-- FR-SOC-9, FR-SOC-10, FR-SOC-11; §7.4 NFR-SCALE-4; D17, D20, D26, D41, D43).
--
-- `groups`, `group_members` and `visibility_rules` were created by WF-041 and
-- are read-only for clients. Every write goes through the security definer
-- functions below (and those of WF-044, WF-045 and WF-047), which:
--   * take the actor from `public.current_user_id()`, never from an argument;
--   * lock the group row (FOR UPDATE) before reading anything they check, so
--     every change to a group's membership, permissions or invites is
--     serialised on that row (this is what makes the member cap race-free);
--   * check permissions on the server: the admin always holds every
--     permission (FR-SOC-9), whatever the member row's columns say.
--
-- Errors are raised with a stable message (the client may match on it) and
-- a SQLSTATE: WF001 no account for this sign-in (private.require_user),
-- 42501 not allowed, P0002 not found, 22023 bad argument, P0001 a rule of the
-- group was broken (e.g. "This group is full"), PT429 rate limited.
-- Non-members get "Group not found" whether or not the group exists.
--
-- Being admin grants management rights only, never extra visibility
-- (FR-SOC-10): nothing here touches `resolve_tier`, and an admin reads other
-- members' schedules through `events_for_viewer` like everyone else.

-- ---------------------------------------------------------------------------
-- Invariant: groups.admin_id names the group's single admin member row.
--
-- The partial unique index `group_members_one_admin_key` (WF-041) allows at
-- most one admin row. These deferred constraint triggers check, at commit,
-- that every group touched in the transaction has exactly one admin row and
-- that it belongs to `groups.admin_id`. The functions keep them in sync; this
-- makes a future path that forgets (e.g. account deletion, WF-114) fail loudly
-- instead of leaving a group with no admin or two versions of the truth.
-- Deferred, because a transfer or a new group needs several statements.
-- ---------------------------------------------------------------------------
create function private.assert_group_admin_in_sync(group_id uuid) returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  group_admin uuid;
  admin_member uuid;
begin
  select g.admin_id into group_admin
  from public.groups g
  where g.id = assert_group_admin_in_sync.group_id;
  if not found then
    return; -- the group was deleted
  end if;

  select m.user_id into admin_member
  from public.group_members m
  where m.group_id = assert_group_admin_in_sync.group_id
    and m.role = 'admin';

  if admin_member is distinct from group_admin then
    raise exception 'Group % must have exactly one admin member, matching groups.admin_id',
      assert_group_admin_in_sync.group_id
      using errcode = '23514';
  end if;
end;
$$;

revoke all on function private.assert_group_admin_in_sync(uuid) from public;

create function private.group_admin_in_sync_trigger() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_table_name = 'groups' then
    perform private.assert_group_admin_in_sync(new.id);
    return null;
  end if;
  if tg_op in ('UPDATE', 'DELETE') then
    perform private.assert_group_admin_in_sync(old.group_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    perform private.assert_group_admin_in_sync(new.group_id);
  end if;
  return null;
end;
$$;

revoke all on function private.group_admin_in_sync_trigger() from public;

create constraint trigger groups_admin_in_sync
  after insert or update of admin_id on public.groups
  deferrable initially deferred
  for each row execute function private.group_admin_in_sync_trigger();

-- Only admin rows can break the invariant (a plain member's row is irrelevant
-- to it), so the member-row triggers skip everything else: joins and leaves
-- of ordinary members cost nothing extra.
create constraint trigger group_members_admin_in_sync_insert
  after insert on public.group_members
  deferrable initially deferred
  for each row when (new.role = 'admin')
  execute function private.group_admin_in_sync_trigger();

create constraint trigger group_members_admin_in_sync_update
  after update on public.group_members
  deferrable initially deferred
  for each row when (old.role = 'admin' or new.role = 'admin')
  execute function private.group_admin_in_sync_trigger();

create constraint trigger group_members_admin_in_sync_delete
  after delete on public.group_members
  deferrable initially deferred
  for each row when (old.role = 'admin')
  execute function private.group_admin_in_sync_trigger();

-- ---------------------------------------------------------------------------
-- Internal helpers (private schema: clients can't call them).
-- ---------------------------------------------------------------------------

-- Reused from earlier migrations (WF-040/042): private.require_user() (the
-- caller's users.id, or WF001 "No account for this sign-in"),
-- private.check_tier(integer) (22023 "tier must be 1, 2 or 3") and
-- private.is_blocked(a, b) (a block in either direction, D43).

-- A group name without surrounding spaces, 1–60 characters.
create function private.clean_group_name(name text) returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  cleaned text := btrim(name);
begin
  if cleaned is null or char_length(cleaned) not between 1 and 60 then
    raise exception 'Group name must be 1 to 60 characters' using errcode = '22023';
  end if;
  return cleaned;
end;
$$;

revoke all on function private.clean_group_name(text) from public;

-- An optional emoji (null or blank = none), at most 16 characters. It is
-- stored as plain text; clients render it as text, never as HTML.
create function private.clean_group_emoji(emoji text) returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  cleaned text := nullif(btrim(emoji), '');
begin
  if cleaned is not null and char_length(cleaned) > 16 then
    raise exception 'Emoji must be at most 16 characters' using errcode = '22023';
  end if;
  return cleaned;
end;
$$;

revoke all on function private.clean_group_emoji(text) from public;

-- Locks the group row (FOR UPDATE) and returns it. Every function that changes
-- a group's membership, permissions or invites calls this first, before
-- checking anything, so concurrent changes to one group run one after the
-- other and each sees the other's committed result (the member cap relies on
-- this). Always lock the group before any invite row, so there is a single
-- lock order.
create function private.lock_group(group_id uuid) returns public.groups
language plpgsql
volatile
set search_path = ''
as $$
declare
  g public.groups;
begin
  select * into g
  from public.groups gr
  where gr.id = lock_group.group_id
  for update;
  if not found then
    raise exception 'Group not found' using errcode = 'P0002';
  end if;
  return g;
end;
$$;

revoke all on function private.lock_group(uuid) from public;

-- The actor's membership row, after checking they may act on the group:
--   'member'        any member;
--   'admin'         the admin only;
--   'invite', 'manageMembers', 'editGroup', 'groupPing' (FR-SOC-8, named as in
--                   GROUP_PERMISSIONS in @whosfree/shared): the admin, or a
--                   member whose column is true.
-- A non-member gets "Group not found", whether or not the group exists.
create function private.authorize_group(group_id uuid, actor uuid, permission text)
returns public.group_members
language plpgsql
stable
set search_path = ''
as $$
declare
  m public.group_members;
  allowed boolean;
begin
  select * into m
  from public.group_members gm
  where gm.group_id = authorize_group.group_id
    and gm.user_id = authorize_group.actor;
  if not found then
    raise exception 'Group not found' using errcode = 'P0002';
  end if;

  allowed := case permission
    when 'member' then true
    when 'admin' then m.role = 'admin'
    when 'invite' then m.role = 'admin' or m.can_invite
    when 'manageMembers' then m.role = 'admin' or m.can_manage_members
    when 'editGroup' then m.role = 'admin' or m.can_edit_group
    when 'groupPing' then m.role = 'admin' or m.can_group_ping
  end;
  if allowed is null then
    raise exception 'Unknown group permission: %', permission using errcode = '22023';
  end if;
  if not allowed then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return m;
end;
$$;

revoke all on function private.authorize_group(uuid, uuid, text) from public;

-- ---------------------------------------------------------------------------
-- create_group(name, emoji, tier): creates a group; the caller becomes its
-- admin with every permission, and their visibility rule for the group is
-- created with the tier they chose (FR-VIS-1, D20: T1 by default).
-- max_members and join_mode take their column defaults (20, 'open'); clients
-- can't set them (NFR-SCALE-4: the cap is raised per group by the operator).
-- ---------------------------------------------------------------------------
create function public.create_group(name text, emoji text default null, tier integer default 1)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_user();
  clean_name text := private.clean_group_name(create_group.name);
  clean_emoji text := private.clean_group_emoji(create_group.emoji);
  chosen_tier smallint := private.check_tier(create_group.tier);
  new_group uuid;
begin
  -- NFR-SEC-9: at most 10 new groups per user per day. Plenty for real use
  -- (clubs, flats, study groups), and it stops scripted group spam. The unit
  -- is only used if the group is actually created (the counter rolls back
  -- with a failed call).
  perform private.consume_rate_limit(actor, 'create_group', 10, interval '1 day');

  insert into public.groups (name, emoji, admin_id)
  values (clean_name, clean_emoji, actor)
  returning groups.id into new_group;

  insert into public.group_members (
    group_id, user_id, role, can_invite, can_manage_members, can_edit_group, can_group_ping
  )
  values (new_group, actor, 'admin', true, true, true, true);

  insert into public.visibility_rules (owner_id, target_type, target_id, tier)
  values (actor, 'group', new_group, chosen_tier);

  return new_group;
end;
$$;

comment on function public.create_group(text, text, integer) is
  'WF-043: creates a group; the caller becomes its admin and their group visibility rule gets the chosen tier (default T1).';

revoke all on function public.create_group(text, text, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.create_group(text, text, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- update_group(group_id, name, emoji): renames the group and sets its emoji
-- (null = no emoji). Needs editGroup (or admin).
-- ---------------------------------------------------------------------------
create function public.update_group(group_id uuid, name text, emoji text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_user();
  clean_name text := private.clean_group_name(update_group.name);
  clean_emoji text := private.clean_group_emoji(update_group.emoji);
begin
  perform private.lock_group(update_group.group_id);
  perform private.authorize_group(update_group.group_id, actor, 'editGroup');

  update public.groups g
  set name = clean_name, emoji = clean_emoji
  where g.id = update_group.group_id;
end;
$$;

comment on function public.update_group(uuid, text, text) is
  'WF-043/044: renames a group and sets its emoji. Admin or editGroup.';

revoke all on function public.update_group(uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.update_group(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- transfer_group_admin(group_id, new_admin_id): the admin hands the role to
-- another member (FR-SOC-7). The new admin gets every permission; the old
-- admin becomes a member with the D26 defaults (the new admin can grant more).
-- groups.admin_id moves with the role (checked at commit by the trigger).
--
-- Works on membership only, whatever blocks exist, so its outcome never
-- reveals a block.
-- ---------------------------------------------------------------------------
create function public.transfer_group_admin(group_id uuid, new_admin_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_user();
begin
  perform private.lock_group(transfer_group_admin.group_id);
  perform private.authorize_group(transfer_group_admin.group_id, actor, 'admin');

  if new_admin_id is null or new_admin_id = actor then
    raise exception 'Choose another member to become admin' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.group_members m
    where m.group_id = transfer_group_admin.group_id
      and m.user_id = transfer_group_admin.new_admin_id
  ) then
    raise exception 'Member not found' using errcode = 'P0002';
  end if;

  -- Demote first: at most one admin row may exist at any moment.
  update public.group_members m
  set role = 'member',
      can_invite = default,
      can_manage_members = default,
      can_edit_group = default,
      can_group_ping = default
  where m.group_id = transfer_group_admin.group_id
    and m.user_id = actor;

  update public.group_members m
  set role = 'admin',
      can_invite = true,
      can_manage_members = true,
      can_edit_group = true,
      can_group_ping = true
  where m.group_id = transfer_group_admin.group_id
    and m.user_id = transfer_group_admin.new_admin_id;

  update public.groups g
  set admin_id = transfer_group_admin.new_admin_id
  where g.id = transfer_group_admin.group_id;
end;
$$;

comment on function public.transfer_group_admin(uuid, uuid) is
  'WF-043: the admin hands the role to another member; the old admin becomes a member with default permissions.';

revoke all on function public.transfer_group_admin(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.transfer_group_admin(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- delete_group(group_id): admin only (FR-SOC-9). Members and invites go with
-- the group (on delete cascade); group visibility rules have no foreign key,
-- so they are deleted here.
-- ---------------------------------------------------------------------------
create function public.delete_group(group_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_user();
begin
  perform private.lock_group(delete_group.group_id);
  perform private.authorize_group(delete_group.group_id, actor, 'admin');

  delete from public.visibility_rules r
  where r.target_type = 'group'
    and r.target_id = delete_group.group_id;

  delete from public.groups g
  where g.id = delete_group.group_id;
end;
$$;

comment on function public.delete_group(uuid) is
  'WF-043: deletes a group, its memberships, invites and group visibility rules. Admin only.';

revoke all on function public.delete_group(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.delete_group(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- list_my_groups(): the caller's groups, with their own role, effective
-- permissions (the admin's are all true) and the tier they chose for the
-- group (no rule = T1, as in resolve_tier).
--
-- member_count counts the members the caller can see: people they have
-- blocked or who have blocked them are left out, as in get_group_members, so
-- the count always matches the member list.
-- ---------------------------------------------------------------------------
create function public.list_my_groups()
returns table (
  id uuid,
  name text,
  emoji text,
  role text,
  member_count integer,
  max_members integer,
  my_tier smallint,
  can_invite boolean,
  can_manage_members boolean,
  can_edit_group boolean,
  can_group_ping boolean,
  joined_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  viewer uuid := private.require_user();
begin
  return query
    select
      g.id,
      g.name,
      g.emoji,
      me.role,
      (
        select count(*)::integer
        from public.group_members o
        where o.group_id = g.id
          and not private.is_blocked(viewer, o.user_id)
      ),
      g.max_members,
      coalesce(r.tier, 1::smallint),
      me.role = 'admin' or me.can_invite,
      me.role = 'admin' or me.can_manage_members,
      me.role = 'admin' or me.can_edit_group,
      me.role = 'admin' or me.can_group_ping,
      me.joined_at
    from public.group_members me
    join public.groups g on g.id = me.group_id
    left join public.visibility_rules r
      on r.owner_id = viewer
     and r.target_type = 'group'
     and r.target_id = g.id
    where me.user_id = viewer
    order by me.joined_at, g.id;
end;
$$;

comment on function public.list_my_groups() is
  'WF-043: the caller''s groups with their role, effective permissions, chosen tier and visible member count.';

revoke all on function public.list_my_groups()
  from public, anon, authenticated, service_role;
grant execute on function public.list_my_groups() to authenticated;

-- ---------------------------------------------------------------------------
-- get_group_members(group_id): the member list, for members only, with each
-- member's public profile (name, handle, avatar), role and effective
-- permissions. Admin first, then by join time.
--
-- Blocks (FR-SOC-6, D43): members the caller has blocked, or who have blocked
-- the caller, are left out, with no placeholder. Nothing about schedules or
-- the tier each member chose is returned; schedules are only readable through
-- events_for_viewer (FR-SOC-10).
-- ---------------------------------------------------------------------------
create function public.get_group_members(group_id uuid)
returns table (
  user_id uuid,
  name text,
  handle text,
  avatar_url text,
  role text,
  can_invite boolean,
  can_manage_members boolean,
  can_edit_group boolean,
  can_group_ping boolean,
  joined_at timestamptz,
  is_me boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  viewer uuid := private.require_user();
begin
  perform private.authorize_group(get_group_members.group_id, viewer, 'member');

  return query
    select
      m.user_id,
      u.name,
      u.handle,
      u.avatar_url,
      m.role,
      m.role = 'admin' or m.can_invite,
      m.role = 'admin' or m.can_manage_members,
      m.role = 'admin' or m.can_edit_group,
      m.role = 'admin' or m.can_group_ping,
      m.joined_at,
      m.user_id = viewer
    from public.group_members m
    join public.users u on u.id = m.user_id
    where m.group_id = get_group_members.group_id
      and not private.is_blocked(viewer, m.user_id)
    order by m.role = 'admin' desc, m.joined_at, m.user_id;
end;
$$;

comment on function public.get_group_members(uuid) is
  'WF-043: a group''s members with public profiles, hiding anyone blocked either way. Members only.';

revoke all on function public.get_group_members(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_group_members(uuid) to authenticated;

-- ============================================================================================
-- 20261001200100_invites.sql
-- ============================================================================================

-- WF-045: invite links, the public invite summary for /i/[code], and the join
-- flow (PRD §6.3 FR-SOC-3, FR-SOC-5, FR-SOC-11, FR-SOC-13; §6.1 FR-WEB-3;
-- FR-VIS-1; §8.5 "Joining a group"; §9 `invites`; D17, D20, D26, D41).
--
-- Conventions as in 20261001200000_groups.sql: every write is a security
-- definer function that takes the actor from current_user_id(), locks the
-- group row first, and checks permissions on the server.

-- ---------------------------------------------------------------------------
-- invites
--
-- `group_id` is nullable so friend invite links (WF-042) can share this table
-- later; until they exist, `invites_group_required` keeps every invite a group
-- invite, and every function here treats an invite without a group as not
-- found. Dropping that constraint is the only schema change friend invites
-- need here.
--
-- `code` is 128 random bits, base64url-encoded (22 characters, no padding):
-- unguessable, so /i/[code] can't be enumerated. The unique constraint is the
-- index lookups use.
-- ---------------------------------------------------------------------------
create table public.invites (
  id uuid primary key default gen_random_uuid(),
  code text not null check (code ~ '^[A-Za-z0-9_-]{22}$'),
  group_id uuid references public.groups (id) on delete cascade,
  -- Who created the link. The invite page shows their display name.
  inviter_id uuid not null references public.users (id) on delete cascade,
  expires_at timestamptz,
  max_uses integer check (max_uses is null or max_uses between 1 and 1000),
  uses integer not null default 0 check (uses >= 0),
  revoked boolean not null default false,
  created_at timestamptz not null default now(),
  constraint invites_code_key unique (code),
  constraint invites_uses_within_max check (max_uses is null or uses <= max_uses),
  constraint invites_group_required check (group_id is not null)
);
create index invites_group_id_idx on public.invites (group_id);
create index invites_inviter_id_idx on public.invites (inviter_id);

comment on table public.invites is
  'Invite links (PRD §9, FR-SOC-3). Not readable by clients: codes are listed by list_group_invites and resolved by get_invite_summary / join_group.';

-- No client privileges at all, and RLS on with no policies: codes are
-- secrets, so they are only returned by the functions below, which check the
-- caller may see them.
alter table public.invites enable row level security;
revoke all on table public.invites from anon, authenticated;

-- ---------------------------------------------------------------------------
-- The invite shape returned by create/regenerate/list (a named type, because
-- the input arguments `expires_at` and `max_uses` would clash with OUT
-- parameters of the same name). It leaves out the group and the inviter's id.
-- ---------------------------------------------------------------------------
create type public.group_invite as (
  id uuid,
  code text,
  expires_at timestamptz,
  max_uses integer,
  uses integer,
  created_at timestamptz,
  created_by_me boolean
);

-- ---------------------------------------------------------------------------
-- private.new_invite_code(): 128 bits from gen_random_uuid(), which draws on
-- Postgres's cryptographically strong random source (pg_strong_random). A
-- version-4 UUID has 122 random bits: its version nibble (hex digit 13) is
-- always 4 and its variant nibble (digit 17) has only 2 random bits, so both
-- are dropped, leaving 30 random hex digits per UUID. Two UUIDs give 60; the
-- first 32 (128 bits) are encoded as base64url without padding. Core
-- Postgres only, so it doesn't depend on pgcrypto's schema.
-- ---------------------------------------------------------------------------
create function private.new_invite_code() returns text
language sql
volatile
set search_path = ''
as $$
  select translate(
    rtrim(
      encode(
        decode(
          left(
            (
              select string_agg(
                overlay(
                  overlay(replace(gen_random_uuid()::text, '-', '') placing '' from 17 for 1)
                  placing '' from 13 for 1
                ),
                ''
              )
              from generate_series(1, 2)
            ),
            32
          ),
          'hex'
        ),
        'base64'
      ),
      '='
    ),
    '+/',
    '-_'
  )
$$;

revoke all on function private.new_invite_code() from public;

-- ---------------------------------------------------------------------------
-- private.invite_status(invite): what the invite can do right now.
--   'revoked'  revoked, or its inviter is no longer a member allowed to invite
--              (they left, were removed or lost `invite`; those paths also set
--              `revoked`, this is the safety net);
--   'expired'  past expires_at;
--   'used_up'  uses reached max_uses;
--   'full'     the group has max_members members (FR-SOC-11);
--   'valid'    otherwise.
-- Null for an invite that isn't a group invite.
-- ---------------------------------------------------------------------------
create function private.invite_status(invite public.invites) returns text
language sql
stable
set search_path = ''
as $$
  select case
    when invite.group_id is null then null
    when invite.revoked
      or not exists (
        select 1
        from public.group_members m
        where m.group_id = invite.group_id
          and m.user_id = invite.inviter_id
          and (m.role = 'admin' or m.can_invite)
      )
      then 'revoked'
    when invite.expires_at is not null and invite.expires_at <= now() then 'expired'
    when invite.max_uses is not null and invite.uses >= invite.max_uses then 'used_up'
    when (select count(*) from public.group_members m where m.group_id = invite.group_id)
      >= (select g.max_members from public.groups g where g.id = invite.group_id)
      then 'full'
    else 'valid'
  end
$$;

revoke all on function private.invite_status(public.invites) from public;

-- The group_invite shape of an invite, as seen by `viewer`.
create function private.to_group_invite(invite public.invites, viewer uuid)
returns public.group_invite
language sql
immutable
set search_path = ''
as $$
  select row(
    invite.id,
    invite.code,
    invite.expires_at,
    invite.max_uses,
    invite.uses,
    invite.created_at,
    invite.inviter_id = viewer
  )::public.group_invite
$$;

revoke all on function private.to_group_invite(public.invites, uuid) from public;

-- Inserts a new group invite from `inviter` (already authorised by the caller).
create function private.insert_group_invite(
  group_id uuid,
  inviter uuid,
  expires_at timestamptz,
  max_uses integer
)
returns public.invites
language plpgsql
volatile
set search_path = ''
as $$
declare
  created public.invites;
begin
  if expires_at is not null and expires_at <= now() then
    raise exception 'Invite expiry must be in the future' using errcode = '22023';
  end if;
  if max_uses is not null and max_uses not between 1 and 1000 then
    raise exception 'Invite max uses must be between 1 and 1000' using errcode = '22023';
  end if;

  insert into public.invites (code, group_id, inviter_id, expires_at, max_uses)
  values (
    private.new_invite_code(),
    insert_group_invite.group_id,
    insert_group_invite.inviter,
    insert_group_invite.expires_at,
    insert_group_invite.max_uses
  )
  returning * into created;
  return created;
end;
$$;

revoke all on function private.insert_group_invite(uuid, uuid, timestamptz, integer) from public;

-- Finds an invite by id and locks its group, for revoke/regenerate. Callers
-- that aren't members of the invite's group get "Invite not found", the same
-- as for an id that doesn't exist. Returns the invite, re-read under the lock.
create function private.lock_invite_for_member(invite_id uuid, actor uuid)
returns public.invites
language plpgsql
volatile
set search_path = ''
as $$
declare
  invite_group uuid;
  invite public.invites;
begin
  select i.group_id into invite_group
  from public.invites i
  where i.id = lock_invite_for_member.invite_id;
  if invite_group is null then
    raise exception 'Invite not found' using errcode = 'P0002';
  end if;

  -- Group first, then the invite: the one lock order.
  perform private.lock_group(invite_group);
  if not exists (
    select 1
    from public.group_members m
    where m.group_id = invite_group
      and m.user_id = lock_invite_for_member.actor
  ) then
    raise exception 'Invite not found' using errcode = 'P0002';
  end if;

  select * into invite
  from public.invites i
  where i.id = lock_invite_for_member.invite_id
  for update;
  return invite;
end;
$$;

revoke all on function private.lock_invite_for_member(uuid, uuid) from public;

-- Who may revoke or regenerate an invite: the admin (FR-SOC-9), or the member
-- who created it while they still hold `invite`.
create function private.authorize_invite_change(invite public.invites, actor uuid)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  m public.group_members := private.authorize_group(invite.group_id, actor, 'member');
begin
  if m.role = 'admin' then
    return;
  end if;
  if invite.inviter_id = actor and m.can_invite then
    return;
  end if;
  raise exception 'Not allowed' using errcode = '42501';
end;
$$;

revoke all on function private.authorize_invite_change(public.invites, uuid) from public;

-- ---------------------------------------------------------------------------
-- create_group_invite(group_id, expires_at, max_uses): a new invite link for
-- the group. Needs `invite` (or admin). Both limits are optional.
-- ---------------------------------------------------------------------------
create function public.create_group_invite(
  group_id uuid,
  expires_at timestamptz default null,
  max_uses integer default null
)
returns public.group_invite
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_user();
  created public.invites;
begin
  perform private.lock_group(create_group_invite.group_id);
  perform private.authorize_group(create_group_invite.group_id, actor, 'invite');

  -- NFR-SEC-9: at most 30 new invite links per user per day, shared with
  -- regenerate_group_invite (same action). A group needs a handful of links;
  -- this stops a member minting codes in bulk.
  perform private.consume_rate_limit(actor, 'group_invite', 30, interval '1 day');

  created := private.insert_group_invite(
    create_group_invite.group_id,
    actor,
    create_group_invite.expires_at,
    create_group_invite.max_uses
  );
  return private.to_group_invite(created, actor);
end;
$$;

comment on function public.create_group_invite(uuid, timestamptz, integer) is
  'WF-045: creates an invite link for a group, with optional expiry and max uses. Admin or invite permission.';

revoke all on function public.create_group_invite(uuid, timestamptz, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.create_group_invite(uuid, timestamptz, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- revoke_group_invite(invite_id): the admin can revoke any of the group's
-- invites; a member can revoke the ones they created while they hold
-- `invite`. Revoking twice is a no-op.
-- ---------------------------------------------------------------------------
create function public.revoke_group_invite(invite_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_user();
  invite public.invites := private.lock_invite_for_member(revoke_group_invite.invite_id, actor);
begin
  perform private.authorize_invite_change(invite, actor);

  update public.invites i
  set revoked = true
  where i.id = invite.id;
end;
$$;

comment on function public.revoke_group_invite(uuid) is
  'WF-045: revokes an invite link. Admin, or the member who created it.';

revoke all on function public.revoke_group_invite(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.revoke_group_invite(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- regenerate_group_invite(invite_id): revokes the invite and issues a new
-- code from the caller, with the same max_uses (uses start again at 0) and
-- the same validity period starting now (a 7-day link gives a new 7-day
-- link). Same permission as revoking. Works on an invite that has already
-- expired, been used up or been revoked.
-- ---------------------------------------------------------------------------
create function public.regenerate_group_invite(invite_id uuid)
returns public.group_invite
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_user();
  previous public.invites := private.lock_invite_for_member(regenerate_group_invite.invite_id, actor);
  created public.invites;
begin
  perform private.authorize_invite_change(previous, actor);

  -- NFR-SEC-9: counts towards the same 30-a-day invite allowance as
  -- create_group_invite.
  perform private.consume_rate_limit(actor, 'group_invite', 30, interval '1 day');

  update public.invites i
  set revoked = true
  where i.id = previous.id;

  created := private.insert_group_invite(
    previous.group_id,
    actor,
    now() + (previous.expires_at - previous.created_at),
    previous.max_uses
  );
  return private.to_group_invite(created, actor);
end;
$$;

comment on function public.regenerate_group_invite(uuid) is
  'WF-045: revokes an invite link and issues a new code with the same limits. Admin, or the member who created it.';

revoke all on function public.regenerate_group_invite(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.regenerate_group_invite(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- list_group_invites(group_id): the group's active invites (not revoked,
-- expired or used up; a full group's invites are still listed), newest first.
-- Needs `invite` (or admin): invite links are there to be shared, so anyone
-- who may invite sees all of the group's links.
-- ---------------------------------------------------------------------------
create function public.list_group_invites(group_id uuid)
returns setof public.group_invite
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_user();
begin
  perform private.authorize_group(list_group_invites.group_id, actor, 'invite');

  return query
    select gi.*
    from public.invites i
    cross join lateral private.to_group_invite(i, actor) gi
    where i.group_id = list_group_invites.group_id
      and private.invite_status(i) in ('valid', 'full')
    order by i.created_at desc, i.id;
end;
$$;

comment on function public.list_group_invites(uuid) is
  'WF-045: a group''s active invite links. Admin or invite permission.';

revoke all on function public.list_group_invites(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.list_group_invites(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- get_invite_summary(code): what the public invite page /i/[code] may show,
-- to anyone, signed in or not (FR-WEB-3).
--
-- Returns no rows for a code that doesn't exist or isn't well formed (the
-- page shows a generic "not found"). Otherwise one row:
--   status        'valid', 'full', 'expired', 'used_up' or 'revoked';
--   inviter_name  the inviter's display name   } only while the link still
--   group_name    the group's name             } works ('valid' or 'full');
--   group_emoji   the group's emoji (nullable) } null once it's revoked,
--   member_count  how many members it has      } expired or used up.
-- Nothing else: no ids, handles, avatars, member names or schedules. A dead
-- link stops describing the group, because it may have been revoked
-- precisely because it reached the wrong people.
--
-- member_count is the true count (it decides "full"), not filtered by blocks:
-- there may be no viewer, and the page shows the same thing to everyone.
--
-- TODO(NFR-SEC-9): callable by anon, so there is no user id to limit on;
-- limit it per IP on the web route (/i/[code]). Guessing codes is not a
-- practical attack (2^128 codes).
-- ---------------------------------------------------------------------------
create function public.get_invite_summary(code text)
returns table (
  status text,
  inviter_name text,
  group_name text,
  group_emoji text,
  member_count integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  invite public.invites;
  invite_state text;
begin
  if code is null or code !~ '^[A-Za-z0-9_-]{22}$' then
    return;
  end if;

  select * into invite
  from public.invites i
  where i.code = get_invite_summary.code;
  if not found then
    return;
  end if;

  invite_state := private.invite_status(invite);
  if invite_state is null then
    return; -- not a group invite
  end if;

  if invite_state not in ('valid', 'full') then
    return query select invite_state, null::text, null::text, null::text, null::integer;
    return;
  end if;

  return query
    select
      invite_state,
      u.name,
      g.name,
      g.emoji,
      (select count(*)::integer from public.group_members m where m.group_id = g.id)
    from public.groups g
    join public.users u on u.id = invite.inviter_id
    where g.id = invite.group_id;
end;
$$;

comment on function public.get_invite_summary(text) is
  'WF-045: the public summary for /i/[code]: status, and while the link works the inviter''s name, group name, emoji and member count. No rows for an unknown code.';

revoke all on function public.get_invite_summary(text)
  from public, anon, authenticated, service_role;
grant execute on function public.get_invite_summary(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- join_group(code, tier): joins the invite's group, in one transaction
-- (PRD §8.5):
--   1. lock the group row, then the invite row;
--   2. already a member?  -> "You are already a member of this group" (the
--      error's DETAIL is the group id, so the client can open the group);
--   3. the invite: revoked / expired / used up -> its own error;
--   4. join_mode 'approval' (FR-SOC-13, a Could) -> "not supported yet"; no
--      member row is created. Nothing can set this mode yet;
--   5. the cap: members >= groups.max_members -> "This group is full";
--   5a. the rate limit (20 joins a day, PT429);
--   6. insert the member row with the D26 default permissions, and the
--      caller's visibility rule for the group with the chosen tier (FR-VIS-1,
--      D20: T1 by default);
--   7. count the use.
-- Returns the group id.
--
-- Concurrency: the count in step 5 runs after the lock in step 1, so two
-- joins racing for the last place run one after the other and the second sees
-- the first's member row. The same lock serialises `uses`.
--
-- Joining never creates a friendship (FR-SOC-5).
--
-- Blocks: a join is never refused because of a block. Refusing would tell
-- the joiner that someone in the group blocked them (FR-SOC-6), and the
-- inviter may be someone else entirely. Instead, blocks keep applying inside
-- the group: resolve_tier gives no access either way, and get_group_members
-- hides each from the other.
-- ---------------------------------------------------------------------------
create function public.join_group(code text, tier integer default 1)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_user();
  chosen_tier smallint := private.check_tier(join_group.tier);
  invite_group uuid;
  grp public.groups;
  invite public.invites;
  invite_state text;
begin
  if code is not null and code ~ '^[A-Za-z0-9_-]{22}$' then
    select i.group_id into invite_group
    from public.invites i
    where i.code = join_group.code;
  end if;
  if invite_group is null then
    raise exception 'Invite not found' using errcode = 'P0002';
  end if;

  grp := private.lock_group(invite_group);
  select * into invite
  from public.invites i
  where i.code = join_group.code
    and i.group_id = grp.id
  for update;
  if not found then
    raise exception 'Invite not found' using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from public.group_members m
    where m.group_id = grp.id
      and m.user_id = actor
  ) then
    raise exception 'You are already a member of this group'
      using errcode = 'P0001', detail = grp.id::text;
  end if;

  invite_state := private.invite_status(invite);
  if invite_state = 'revoked' then
    raise exception 'This invite has been revoked' using errcode = 'P0001';
  elsif invite_state = 'expired' then
    raise exception 'This invite has expired' using errcode = 'P0001';
  elsif invite_state = 'used_up' then
    raise exception 'This invite has reached its maximum number of uses' using errcode = 'P0001';
  end if;

  if grp.join_mode <> 'open' then
    raise exception 'Joining groups that need approval is not supported yet'
      using errcode = '0A000';
  end if;

  if (select count(*) from public.group_members m where m.group_id = grp.id) >= grp.max_members then
    raise exception 'This group is full' using errcode = 'P0001';
  end if;

  -- NFR-SEC-9: at most 20 group joins per user per day. Only successful joins
  -- count (a failed call rolls the counter back), so this limits how fast one
  -- account can spread into groups, not how many codes it can try; codes are
  -- unguessable anyway.
  perform private.consume_rate_limit(actor, 'join_group', 20, interval '1 day');

  -- Role and permissions take the column defaults: member, D26.
  insert into public.group_members (group_id, user_id)
  values (grp.id, actor);

  -- A rule left behind earlier would grant nothing (resolve_tier only reads
  -- rules while both are members), but replace it so the chosen tier applies.
  insert into public.visibility_rules (owner_id, target_type, target_id, tier)
  values (actor, 'group', grp.id, chosen_tier)
  on conflict (owner_id, target_type, target_id) do update set tier = excluded.tier;

  update public.invites i
  set uses = i.uses + 1
  where i.id = invite.id;

  return grp.id;
end;
$$;

comment on function public.join_group(text, integer) is
  'WF-045: joins a group through an invite code with the chosen tier (default T1), in one transaction. Checks the invite and the member cap under a lock on the group.';

revoke all on function public.join_group(text, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.join_group(text, integer) to authenticated;

-- ============================================================================================
-- 20261001200200_group_member_permissions.sql
-- ============================================================================================

-- WF-044: group member permissions and removing members (PRD §6.3 FR-SOC-8,
-- FR-SOC-9, FR-SOC-10; J7; D26).
--
-- The four permissions are the group_members columns can_invite,
-- can_manage_members, can_edit_group and can_group_ping (`invite`,
-- `manageMembers`, `editGroup`, `groupPing` in @whosfree/shared). New members
-- get the D26 defaults from the column defaults (join_group). The admin always
-- holds every permission (FR-SOC-9): private.authorize_group treats the admin
-- as allowed whatever the columns say, and their columns can't be changed.
-- `can_group_ping` is stored for group pings (WF-096); nothing reads it yet.
--
-- Conventions as in 20261001200000_groups.sql.

-- ---------------------------------------------------------------------------
-- private.drop_membership(group_id, user_id): ends a membership, for removal
-- (here) and leaving (WF-047). Visibility ends at once, because resolve_tier
-- only counts groups both people are in now; the member's own group rule is
-- deleted too, and the invite links they created are revoked so they can't
-- be used to join a group the inviter is no longer in. Callers lock the group
-- and authorise first.
-- ---------------------------------------------------------------------------
create function private.drop_membership(group_id uuid, user_id uuid) returns void
language plpgsql
volatile
set search_path = ''
as $$
begin
  delete from public.group_members m
  where m.group_id = drop_membership.group_id
    and m.user_id = drop_membership.user_id;

  delete from public.visibility_rules r
  where r.owner_id = drop_membership.user_id
    and r.target_type = 'group'
    and r.target_id = drop_membership.group_id;

  update public.invites i
  set revoked = true
  where i.group_id = drop_membership.group_id
    and i.inviter_id = drop_membership.user_id
    and not i.revoked;
end;
$$;

revoke all on function private.drop_membership(uuid, uuid) from public;

-- ---------------------------------------------------------------------------
-- set_group_member_permissions(group_id, user_id, can_invite,
-- can_manage_members, can_edit_group, can_group_ping): the admin grants or
-- revokes permissions for one member (FR-SOC-8). A null argument leaves that
-- permission as it is. Taking `invite` away also revokes the member's active
-- invite links for the group.
-- ---------------------------------------------------------------------------
create function public.set_group_member_permissions(
  group_id uuid,
  user_id uuid,
  can_invite boolean default null,
  can_manage_members boolean default null,
  can_edit_group boolean default null,
  can_group_ping boolean default null
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_user();
  target public.group_members;
begin
  perform private.lock_group(set_group_member_permissions.group_id);
  perform private.authorize_group(set_group_member_permissions.group_id, actor, 'admin');

  select * into target
  from public.group_members m
  where m.group_id = set_group_member_permissions.group_id
    and m.user_id = set_group_member_permissions.user_id;
  if not found then
    raise exception 'Member not found' using errcode = 'P0002';
  end if;
  if target.role = 'admin' then
    raise exception 'The admin always holds every permission' using errcode = '22023';
  end if;

  update public.group_members m
  set can_invite = coalesce(set_group_member_permissions.can_invite, m.can_invite),
      can_manage_members =
        coalesce(set_group_member_permissions.can_manage_members, m.can_manage_members),
      can_edit_group = coalesce(set_group_member_permissions.can_edit_group, m.can_edit_group),
      can_group_ping = coalesce(set_group_member_permissions.can_group_ping, m.can_group_ping)
  where m.id = target.id;

  if set_group_member_permissions.can_invite is false then
    update public.invites i
    set revoked = true
    where i.group_id = set_group_member_permissions.group_id
      and i.inviter_id = set_group_member_permissions.user_id
      and not i.revoked;
  end if;
end;
$$;

comment on function public.set_group_member_permissions(uuid, uuid, boolean, boolean, boolean, boolean) is
  'WF-044: the admin grants or revokes a member''s permissions (null = unchanged). Revoking invite also revokes their invite links.';

revoke all on function public.set_group_member_permissions(uuid, uuid, boolean, boolean, boolean, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.set_group_member_permissions(uuid, uuid, boolean, boolean, boolean, boolean)
  to authenticated;

-- ---------------------------------------------------------------------------
-- remove_group_member(group_id, user_id): removes a member. Needs
-- `manageMembers` (or admin). The admin can never be removed, and a member
-- leaves with leave_group instead. Like transfer, it works on membership
-- whatever blocks exist, so its outcome never reveals a block.
-- ---------------------------------------------------------------------------
create function public.remove_group_member(group_id uuid, user_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_user();
  target public.group_members;
begin
  perform private.lock_group(remove_group_member.group_id);
  perform private.authorize_group(remove_group_member.group_id, actor, 'manageMembers');

  if remove_group_member.user_id = actor then
    raise exception 'Use leave_group to leave a group' using errcode = '22023';
  end if;

  select * into target
  from public.group_members m
  where m.group_id = remove_group_member.group_id
    and m.user_id = remove_group_member.user_id;
  if not found then
    raise exception 'Member not found' using errcode = 'P0002';
  end if;
  if target.role = 'admin' then
    raise exception 'The admin can''t be removed from the group' using errcode = 'P0001';
  end if;

  perform private.drop_membership(remove_group_member.group_id, remove_group_member.user_id);
end;
$$;

comment on function public.remove_group_member(uuid, uuid) is
  'WF-044: removes a member (never the admin). Admin or manageMembers.';

revoke all on function public.remove_group_member(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.remove_group_member(uuid, uuid) to authenticated;

-- ============================================================================================
-- 20261001200300_leave_group.sql
-- ============================================================================================

-- WF-047 (leave group only): a member leaves a group (PRD §6.3 FR-SOC-6,
-- FR-SOC-7). Blocking and removing friends are separate work.
--
-- Visibility ends straight away: resolve_tier only counts groups both people
-- are in now, and private.drop_membership also deletes the leaver's group
-- visibility rule and revokes the invite links they created.

-- ---------------------------------------------------------------------------
-- leave_group(group_id): the caller leaves. The admin must transfer the role
-- first (FR-SOC-7); an admin who is the only member deletes the group instead
-- (delete_group).
-- ---------------------------------------------------------------------------
create function public.leave_group(group_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_user();
  me public.group_members;
begin
  perform private.lock_group(leave_group.group_id);
  me := private.authorize_group(leave_group.group_id, actor, 'member');

  if me.role = 'admin' then
    raise exception 'Transfer the admin role before leaving the group' using errcode = 'P0001';
  end if;

  perform private.drop_membership(leave_group.group_id, actor);
end;
$$;

comment on function public.leave_group(uuid) is
  'WF-047: the caller leaves a group; visibility ends at once. The admin must transfer the role first.';

revoke all on function public.leave_group(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.leave_group(uuid) to authenticated;

-- ============================================================================================
-- 20261001300000_ensure_current_user.sql
-- ============================================================================================

-- WF-004: create the signed-in user's `users` row on first sign-in (PRD §9,
-- FR-AUTH-2, FR-AUTH-3, D19, D41).
--
-- Clients have no INSERT privilege on `users` (WF-003). The web app calls
-- `ensure_current_user()` with the user's Clerk session token (from the
-- browser, or from the Next.js server acting as the user) after sign-in. The
-- Clerk user ID comes only from the verified token (`auth.jwt() ->> 'sub'`),
-- never from an argument, so nobody can create or claim someone else's row.
-- Clerk session tokens must carry `role: "authenticated"` so PostgREST runs
-- the request as `authenticated`, the only role allowed to call this.
--
-- No Clerk webhook path is added: the first-request call covers creation, and
-- a webhook would race it (a row created by `user.created` has no detected
-- timezone, and the idempotent call below would then keep the webhook's
-- default). Profile edits belong to the app after creation, so `user.updated`
-- should not overwrite them, and `user.deleted` must go through account
-- deletion (WF-114), which hands over group admin roles first.

-- ---------------------------------------------------------------------------
-- public.ensure_current_user(name, avatar_url, timezone): the caller's users
-- row, created on the first call.
--
--   * Idempotent: if the caller already has a row it is returned unchanged,
--     whatever the arguments (so a later sign-in never overwrites a profile
--     the user has edited). The arguments are validated only when creating.
--   * name: trimmed, 1-100 characters, no control characters.
--   * avatar_url: null, empty (= null) or an https URL of at most 2048
--     characters (Clerk's Google avatar URLs are https).
--   * timezone: an IANA name; null or empty means America/Jamaica
--     (FR-AUTH-3). Unknown names are rejected by the users timezone trigger.
--   * Concurrent first calls (two tabs) are safe: the insert does nothing on
--     a clerk_id conflict and the existing row is returned.
--   * The default `availability_prefs` row (WF-062) is created by a trigger on
--     users, in the same transaction.
--
-- security definer because clients can't insert into users. It only ever
-- writes the row for the token's own `sub`.
-- ---------------------------------------------------------------------------
create function public.ensure_current_user(
  name text,
  avatar_url text default null,
  timezone text default 'America/Jamaica'
)
returns public.users
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  clerk_sub text := auth.jwt() ->> 'sub';
  clean_name text;
  clean_avatar text;
  clean_timezone text;
  result public.users;
begin
  if clerk_sub is null or clerk_sub = '' then
    raise exception 'Not signed in: the token has no subject (sub) claim'
      using errcode = '28000';
  end if;

  select * into result from public.users u where u.clerk_id = clerk_sub;
  if found then
    return result;
  end if;

  clean_name := pg_catalog.regexp_replace(ensure_current_user.name, '^\s+|\s+$', '', 'g');
  if clean_name is null or pg_catalog.char_length(clean_name) not between 1 and 100 then
    raise exception 'Name must be 1-100 characters' using errcode = '22023';
  end if;
  if clean_name ~ '[[:cntrl:]]' then
    raise exception 'Name must not contain control characters' using errcode = '22023';
  end if;

  clean_avatar := nullif(pg_catalog.btrim(ensure_current_user.avatar_url), '');
  if clean_avatar is not null
    and (clean_avatar !~* '^https://' or pg_catalog.char_length(clean_avatar) > 2048)
  then
    raise exception 'Avatar URL must be an https URL of at most 2048 characters'
      using errcode = '22023';
  end if;

  clean_timezone := coalesce(
    nullif(pg_catalog.btrim(ensure_current_user.timezone), ''),
    'America/Jamaica'
  );

  -- The users timezone trigger raises 'Unknown timezone: ...' (22023).
  insert into public.users (clerk_id, name, avatar_url, timezone)
  values (clerk_sub, clean_name, clean_avatar, clean_timezone)
  on conflict (clerk_id) do nothing
  returning * into result;

  if not found then
    select * into result from public.users u where u.clerk_id = clerk_sub;
  end if;
  return result;
end;
$$;

comment on function public.ensure_current_user(text, text, text) is
  'WF-004: returns the caller''s users row, creating it (and its default availability_prefs) on first sign-in. The Clerk ID comes only from the token. Idempotent: never changes an existing row.';

revoke all on function public.ensure_current_user(text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.ensure_current_user(text, text, text) to authenticated;

-- ============================================================================================
-- 20261001300100_age_gate.sql
-- ============================================================================================

-- WF-005: the 18+ age gate (FR-AUTH-6, NFR-COMP-7, D13, D29).
--
-- The full date of birth never reaches the database. The Next.js server checks
-- it with `checkAge()` from @whosfree/shared (exact to the day, against today's
-- date in America/Jamaica), then calls `confirm_age(birth_year)` with the
-- user's own Clerk token. Only the birth year and the confirmation time are
-- stored.
--
-- Why `authenticated` may call it rather than only the service role: the check
-- is self-declared (D29), so a client calling the function directly with a
-- made-up year is no less trustworthy than one typing a made-up date of birth
-- into the form. Keeping it a user-token call means the server needs no
-- service-role key for sign-up (D41: service role for background work only)
-- and the function can take the user from the token instead of an argument.
-- It still refuses any year that can't belong to an adult.
--
-- The confirmation is permanent: once set, the birth year and time can't be
-- changed by the user, and a trigger stops any role (even the service role)
-- from changing them by mistake. Under-18 reports are handled by suspension
-- and deletion (FR-AUTH-6), not by editing the year.

alter table public.users
  add constraint users_age_confirmation_complete
  check ((birth_year is null) = (age_confirmed_at is null));

-- ---------------------------------------------------------------------------
-- Write-once guard on birth_year and age_confirmed_at.
-- ---------------------------------------------------------------------------
create function private.protect_age_confirmation() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.age_confirmed_at is not null
    and (
      new.birth_year is distinct from old.birth_year
      or new.age_confirmed_at is distinct from old.age_confirmed_at
    )
  then
    raise exception 'birth_year and age_confirmed_at are write-once (the age is already confirmed)'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

revoke all on function private.protect_age_confirmation() from public;

create trigger users_protect_age_confirmation
  before update of birth_year, age_confirmed_at on public.users
  for each row execute function private.protect_age_confirmation();

-- ---------------------------------------------------------------------------
-- public.confirm_age(birth_year): records the caller's birth year and the
-- confirmation time. Returns age_confirmed_at.
--
--   * The caller must have a users row (ensure_current_user first).
--   * birth_year must be 1900 or later and at most (latest calendar year
--     anywhere on Earth right now, i.e. in UTC+14) - 18: a necessary condition
--     for being 18 today in any timezone. The exact, to-the-day check is
--     checkAge() on the server, which is the only place the full date exists.
--   * Once confirmed, a repeat call with the same year returns the original
--     confirmation time unchanged (safe to retry); a different year is refused.
--
-- security definer because clients can't write birth_year or age_confirmed_at.
-- ---------------------------------------------------------------------------
create function public.confirm_age(birth_year integer)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := public.current_user_id();
  latest_adult_year integer :=
    pg_catalog.date_part('year', pg_catalog.now() at time zone 'Pacific/Kiritimati')::integer - 18;
  stored_year smallint;
  stored_at timestamptz;
begin
  if me is null then
    raise exception 'User profile not found: call ensure_current_user first'
      using errcode = 'P0002';
  end if;

  if confirm_age.birth_year is null
    or confirm_age.birth_year not between 1900 and latest_adult_year
  then
    raise exception 'Birth year must be between 1900 and % (18 or over)', latest_adult_year
      using errcode = '22023';
  end if;

  select u.birth_year, u.age_confirmed_at into stored_year, stored_at
  from public.users u
  where u.id = me
  for update;

  if stored_at is not null then
    if stored_year = confirm_age.birth_year then
      return stored_at;
    end if;
    raise exception 'Age is already confirmed; the birth year can''t be changed'
      using errcode = '55000';
  end if;

  update public.users
  set birth_year = confirm_age.birth_year, age_confirmed_at = pg_catalog.now()
  where id = me;

  return pg_catalog.now();
end;
$$;

comment on function public.confirm_age(integer) is
  'WF-005: records the caller''s birth year and age_confirmed_at, once. The full date of birth is checked on the server (checkAge in @whosfree/shared) and never stored.';

revoke all on function public.confirm_age(integer) from public, anon, authenticated, service_role;
grant execute on function public.confirm_age(integer) to authenticated;

-- ============================================================================================
-- 20261001300200_consent_record.sql
-- ============================================================================================

-- WF-015: versioned consent record for the terms and privacy notice (FR-SET-5).
--
-- The current version lives in one SQL function, `current_consent_version()`,
-- rather than a config table:
--   * changing it is a migration, so it is reviewed and deployed together with
--     the new text in docs/legal, and nobody can bump it by accident from the
--     dashboard (which would force every user to re-accept);
--   * there is no table to grant, protect with RLS, or seed.
-- The terms and the privacy notice share one version (both docs carry the
-- same "Version" line), matching the single `users.consent_version` column.
-- To publish a new version: `create or replace` the function in a new
-- migration with the new string. Every user whose consent_version differs is
-- then asked to accept again (`account_status().consent_required`).
--
-- Users can't write consent_version or consent_at themselves (WF-003 column
-- grants); `accept_consent()` sets them, and only to the current version and
-- the server's clock, so a version can't be invented or a time backdated.

alter table public.users
  add constraint users_consent_complete
  check ((consent_version is null) = (consent_at is null));

-- ---------------------------------------------------------------------------
-- public.current_consent_version(): the terms/privacy version users must
-- accept. '0.1-draft' is the version on the current drafts in docs/legal;
-- publishing them (WF-010) replaces it.
-- ---------------------------------------------------------------------------
create function public.current_consent_version() returns text
language sql
stable
set search_path = ''
as $$
  select '0.1-draft'::text
$$;

comment on function public.current_consent_version() is
  'WF-015: the terms/privacy version users must have accepted. Changed only by a migration.';

revoke all on function public.current_consent_version()
  from public, anon, authenticated, service_role;
grant execute on function public.current_consent_version() to authenticated;

-- ---------------------------------------------------------------------------
-- public.accept_consent(version): records that the caller accepted `version`,
-- which must be the current version (the one the page showed them). Returns
-- consent_at.
--
--   * A stale or unknown version is refused, so a page left open across a
--     policy change can't record acceptance of text the user didn't see.
--   * Accepting the version already on record keeps the original consent_at.
--   * consent_at is always now(); it can't be supplied.
--
-- security definer because clients can't write the consent columns.
-- ---------------------------------------------------------------------------
create function public.accept_consent(version text)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := public.current_user_id();
  current_version text := public.current_consent_version();
  stored_version text;
  stored_at timestamptz;
begin
  if me is null then
    raise exception 'User profile not found: call ensure_current_user first'
      using errcode = 'P0002';
  end if;

  if accept_consent.version is distinct from current_version then
    raise exception 'Consent version % is not the current version (%)',
      coalesce(pg_catalog.quote_literal(accept_consent.version), 'NULL'), current_version
      using errcode = '22023';
  end if;

  select u.consent_version, u.consent_at into stored_version, stored_at
  from public.users u
  where u.id = me
  for update;

  if stored_version = current_version then
    return stored_at;
  end if;

  update public.users
  set consent_version = current_version, consent_at = pg_catalog.now()
  where id = me;

  return pg_catalog.now();
end;
$$;

comment on function public.accept_consent(text) is
  'WF-015: records consent_version and consent_at for the caller, only for the current version and at the server''s time.';

revoke all on function public.accept_consent(text) from public, anon, authenticated, service_role;
grant execute on function public.accept_consent(text) to authenticated;

-- ---------------------------------------------------------------------------
-- public.account_status(): what the web middleware needs to decide whether
-- the signed-in user may use app routes (WF-004, WF-005, WF-015). One row:
--
--   has_profile             the users row exists (else call ensure_current_user)
--   age_confirmed           the age gate is passed (WF-005)
--   consent_version         the version on record, or null
--   current_consent_version the version to show and accept
--   consent_required        true until the current version is accepted, and
--                           again whenever the version changes
--
-- The app is usable only when has_profile and age_confirmed are true and
-- consent_required is false. Runs as the caller (reads the own row under RLS).
-- ---------------------------------------------------------------------------
create function public.account_status()
returns table (
  has_profile boolean,
  age_confirmed boolean,
  consent_version text,
  current_consent_version text,
  consent_required boolean
)
language sql
stable
set search_path = ''
as $$
  select
    u.id is not null,
    u.age_confirmed_at is not null,
    u.consent_version,
    c.version,
    u.consent_version is distinct from c.version
  from (select public.current_consent_version() as version) c
  left join public.users u on u.id = public.current_user_id()
$$;

comment on function public.account_status() is
  'WF-004/005/015: whether the caller has a profile, has passed the age gate, and must (re-)accept the current terms/privacy version.';

revoke all on function public.account_status() from public, anon, authenticated, service_role;
grant execute on function public.account_status() to authenticated;

-- ============================================================================================
-- 20261001300300_availability_prefs.sql
-- ============================================================================================

-- WF-062: available hours and the other availability settings (PRD §9
-- `availabilityPrefs`, FR-AVL-2, FR-AVL-8, FR-GCAL-6, D24).
--
-- One row per user, created with the users row (trigger below) so every user
-- always has one, with the D24 default of 08:00-22:00 every day.
--
-- `weekly` is a jsonb array in exactly the shape of `AvailableHours[]` from
-- @whosfree/shared, `[{"day": "mon", "start": "08:00", "end": "22:00"}, ...]`,
-- rather than a child table:
--   * it is what the availability engine takes (`availableHours`), so readers
--     (the owner's settings page now, the Now function WF-064 and the slot
--     finder later) pass it through with no join or aggregation;
--   * a week is read and replaced as one value in one row, so there is no
--     half-updated week and no per-day rows to keep in step;
--   * the trigger below validates it as strictly as table constraints would
--     (known days, HH:MM, end after start, one window per day, no extra keys)
--     and stores it in a canonical order (mon..sun).
-- A day with no entry means "not available that day" (away all day), which
-- the engine supports; an empty array means always away.
--
-- Only the owner can read or change their row (RLS). Other users' hours are
-- not selectable; WF-064 will read them inside its security definer function.

create table public.availability_prefs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  weekly jsonb not null default '[
    {"day": "mon", "start": "08:00", "end": "22:00"},
    {"day": "tue", "start": "08:00", "end": "22:00"},
    {"day": "wed", "start": "08:00", "end": "22:00"},
    {"day": "thu", "start": "08:00", "end": "22:00"},
    {"day": "fri", "start": "08:00", "end": "22:00"},
    {"day": "sat", "start": "08:00", "end": "22:00"},
    {"day": "sun", "start": "08:00", "end": "22:00"}
  ]'::jsonb,
  -- FR-AVL-8: gaps shorter than this count as busy. Up to 4 hours.
  min_gap_minutes smallint not null default 15 check (min_gap_minutes between 0 and 240),
  -- FR-GCAL-6: whether all-day Google events make the user busy.
  count_all_day_events boolean not null default false,
  created_at timestamptz not null default now(),
  constraint availability_prefs_user_id_key unique (user_id)
);

comment on table public.availability_prefs is
  'One row per user (PRD §9 availabilityPrefs). weekly is AvailableHours[] from @whosfree/shared, validated and ordered by trigger. Owner-only under RLS.';

-- ---------------------------------------------------------------------------
-- Validates `weekly` and rewrites it in canonical form: entries ordered
-- mon..sun, each exactly {day, start, end}. Raises 22023 with a specific
-- message for each problem.
-- ---------------------------------------------------------------------------
create function private.validate_weekly_hours() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  days constant text[] := array['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  entry jsonb;
  seen text[] := '{}';
  entry_day text;
  entry_start text;
  entry_end text;
begin
  if new.weekly is null or jsonb_typeof(new.weekly) <> 'array' then
    raise exception 'Available hours must be an array of {day, start, end}'
      using errcode = '22023';
  end if;

  for entry in select e.value from jsonb_array_elements(new.weekly) e loop
    if jsonb_typeof(entry) <> 'object'
      or (select array_agg(k order by k) from jsonb_object_keys(entry) k)
        is distinct from array['day', 'end', 'start']
      or jsonb_typeof(entry -> 'day') <> 'string'
      or jsonb_typeof(entry -> 'start') <> 'string'
      or jsonb_typeof(entry -> 'end') <> 'string'
    then
      raise exception 'Each available-hours entry must be exactly {day, start, end} with string values'
        using errcode = '22023';
    end if;

    entry_day := entry ->> 'day';
    entry_start := entry ->> 'start';
    entry_end := entry ->> 'end';

    if not (entry_day = any (days)) then
      raise exception 'Unknown day: %', entry_day using errcode = '22023';
    end if;
    if entry_day = any (seen) then
      raise exception 'Duplicate day: % (one window per day)', entry_day using errcode = '22023';
    end if;
    seen := seen || entry_day;

    if entry_start !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
      raise exception 'Invalid start time on %: % (expected HH:MM, 24-hour)', entry_day, entry_start
        using errcode = '22023';
    end if;
    if entry_end !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
      raise exception 'Invalid end time on %: % (expected HH:MM, 24-hour)', entry_day, entry_end
        using errcode = '22023';
    end if;
    -- Zero-padded HH:MM strings compare in time order.
    if entry_end <= entry_start then
      raise exception 'End must be after start on %: % to %', entry_day, entry_start, entry_end
        using errcode = '22023';
    end if;
  end loop;

  new.weekly := coalesce(
    (
      select jsonb_agg(
        jsonb_build_object('day', e.value ->> 'day', 'start', e.value ->> 'start', 'end', e.value ->> 'end')
        order by array_position(days, e.value ->> 'day')
      )
      from jsonb_array_elements(new.weekly) e
    ),
    '[]'::jsonb
  );
  return new;
end;
$$;

revoke all on function private.validate_weekly_hours() from public;

create trigger availability_prefs_validate_weekly
  before insert or update of weekly on public.availability_prefs
  for each row execute function private.validate_weekly_hours();

-- ---------------------------------------------------------------------------
-- Every new users row gets its default prefs row in the same transaction
-- (ensure_current_user, WF-004, and any server-side insert).
-- ---------------------------------------------------------------------------
create function private.create_default_availability_prefs() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  insert into public.availability_prefs (user_id) values (new.id);
  return null;
end;
$$;

revoke all on function private.create_default_availability_prefs() from public;

create trigger users_create_default_availability_prefs
  after insert on public.users
  for each row execute function private.create_default_availability_prefs();

-- Users created before this migration.
insert into public.availability_prefs (user_id)
select u.id from public.users u
on conflict (user_id) do nothing;

-- ---------------------------------------------------------------------------
-- Privileges and RLS: the owner reads and edits their own settings. Rows are
-- created by the trigger and deleted with the user, so no INSERT or DELETE.
-- ---------------------------------------------------------------------------
alter table public.availability_prefs enable row level security;

revoke all on table public.availability_prefs from anon, authenticated;
grant select on table public.availability_prefs to authenticated;
grant update (weekly, min_gap_minutes, count_all_day_events)
  on table public.availability_prefs to authenticated;

create policy availability_prefs_select_own on public.availability_prefs
  for select to authenticated
  using (user_id = (select public.current_user_id()));

create policy availability_prefs_update_own on public.availability_prefs
  for update to authenticated
  using (user_id = (select public.current_user_id()))
  with check (user_id = (select public.current_user_id()));

-- ---------------------------------------------------------------------------
-- public.set_day_hours(day, start_time, end_time): edits one day of the
-- caller's available hours (FR-AVL-2 "edit each day separately") and returns
-- the new week. Both times null = not available that day. The rest of the week
-- is untouched, and the change is one atomic UPDATE, so two edits to
-- different days can't overwrite each other.
--
-- Runs as the caller (not security definer): it's an ordinary UPDATE of the
-- caller's own row under RLS; the trigger validates the result.
-- ---------------------------------------------------------------------------
create function public.set_day_hours(
  day text,
  start_time text default null,
  end_time text default null
)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  result jsonb;
begin
  if set_day_hours.day is null
    or not (set_day_hours.day = any (array['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']))
  then
    raise exception 'Unknown day: %', coalesce(set_day_hours.day, 'NULL') using errcode = '22023';
  end if;
  if (set_day_hours.start_time is null) <> (set_day_hours.end_time is null) then
    raise exception 'Give both start and end times, or neither to mark the day unavailable'
      using errcode = '22023';
  end if;

  update public.availability_prefs p
  set weekly = coalesce(
      (
        select jsonb_agg(e.value)
        from jsonb_array_elements(p.weekly) e
        where e.value ->> 'day' <> set_day_hours.day
      ),
      '[]'::jsonb
    ) || case
      when set_day_hours.start_time is null then '[]'::jsonb
      else jsonb_build_array(
        jsonb_build_object(
          'day', set_day_hours.day,
          'start', set_day_hours.start_time,
          'end', set_day_hours.end_time
        )
      )
    end
  where p.user_id = public.current_user_id()
  returning p.weekly into result;

  if not found then
    raise exception 'User profile not found: call ensure_current_user first'
      using errcode = 'P0002';
  end if;
  return result;
end;
$$;

comment on function public.set_day_hours(text, text, text) is
  'WF-062: sets (or clears, with null times) one day of the caller''s available hours and returns the whole week.';

revoke all on function public.set_day_hours(text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.set_day_hours(text, text, text) to authenticated;

-- ============================================================================================
-- 20261001300400_status_overrides.sql
-- ============================================================================================

-- WF-063: manual status override (PRD §9 `statusOverrides`, FR-AVL-3, J5, D5).
--
-- A user sets a status (Free, Busy, Do not disturb, Away, Studying/Focused)
-- that overrides their calendar until an end time or "until I change it"
-- (ends_at null). The availability engine applies overrides in
-- [starts_at, ends_at); when several are active the latest-starting one wins.
--
-- Clients can only read their own rows. Writes go through `set_status()` and
-- `clear_status()`, which always start at now(), so a user can't backdate a
-- status or schedule one far ahead, and which close the previous status:
-- without that, an old "until I change it" status would come back when a
-- newer timed one ends. Other users' overrides are not selectable; the Now
-- function (WF-064) will read them inside its security definer function and
-- decide which tiers may see the label.

create table public.status_overrides (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  -- MANUAL_STATUSES in @whosfree/shared. `focused` is shown to viewers as busy.
  status text not null check (status in ('free', 'busy', 'dnd', 'away', 'focused')),
  -- Optional short plain-text label, e.g. "Revising for MATH1141". Trimmed,
  -- 1-40 characters, no control characters. The UI should not suggest
  -- putting a location here (D35).
  label text check (
    label is null
    or (
      char_length(label) between 1 and 40
      and label = btrim(label)
      and label !~ '[[:cntrl:]]'
    )
  ),
  starts_at timestamptz not null default now(),
  -- Null = "until I change it".
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  constraint status_overrides_ends_after_start check (ends_at is null or ends_at > starts_at)
);

create index status_overrides_user_id_starts_at_idx
  on public.status_overrides (user_id, starts_at);

-- At most one open-ended ("until I change it") status per user. set_status()
-- closes the previous one before inserting, so this never fires in normal use;
-- it guards against a write path that forgets to.
create unique index status_overrides_one_open_key
  on public.status_overrides (user_id)
  where ends_at is null;

comment on table public.status_overrides is
  'Manual statuses (PRD §9 statusOverrides, FR-AVL-3). Owner-readable only; written by set_status() and clear_status().';

-- ---------------------------------------------------------------------------
-- private.close_active_status(user): ends the user's current status now.
-- Rows that started at this same instant (an earlier set_status in the same
-- transaction) are deleted instead, since they would have no duration.
-- Callers must hold the user's row lock (see set_status).
-- ---------------------------------------------------------------------------
create function private.close_active_status(owner uuid) returns void
language plpgsql
set search_path = ''
as $$
begin
  delete from public.status_overrides o
  where o.user_id = close_active_status.owner
    and o.starts_at >= pg_catalog.now();

  update public.status_overrides o
  set ends_at = pg_catalog.now()
  where o.user_id = close_active_status.owner
    and o.starts_at < pg_catalog.now()
    and (o.ends_at is null or o.ends_at > pg_catalog.now());
end;
$$;

revoke all on function private.close_active_status(uuid) from public;

-- ---------------------------------------------------------------------------
-- public.set_status(status, label, ends_at): sets the caller's manual status
-- from now until ends_at (null = "until I change it"), closing whatever status
-- was active. Returns the new row.
--
--   * status: one of free, busy, dnd, away, focused.
--   * label: optional; trimmed; empty = none; at most 40 characters; no
--     control characters.
--   * ends_at: null, or in the future and at most 7 days away (the engine's
--     "until X" look-ahead; anything longer is "until I change it").
--
-- security definer because clients can't write status_overrides directly.
-- ---------------------------------------------------------------------------
create function public.set_status(
  status text,
  label text default null,
  ends_at timestamptz default null
)
returns public.status_overrides
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := public.current_user_id();
  clean_label text;
  result public.status_overrides;
begin
  if me is null then
    raise exception 'User profile not found: call ensure_current_user first'
      using errcode = 'P0002';
  end if;

  if set_status.status is null
    or not (set_status.status = any (array['free', 'busy', 'dnd', 'away', 'focused']))
  then
    raise exception 'Unknown status: %', coalesce(set_status.status, 'NULL')
      using errcode = '22023';
  end if;

  clean_label := nullif(pg_catalog.regexp_replace(set_status.label, '^\s+|\s+$', '', 'g'), '');
  if clean_label is not null and pg_catalog.char_length(clean_label) > 40 then
    raise exception 'Label must be at most 40 characters' using errcode = '22023';
  end if;
  if clean_label ~ '[[:cntrl:]]' then
    raise exception 'Label must not contain control characters' using errcode = '22023';
  end if;

  if set_status.ends_at is not null then
    if set_status.ends_at <= pg_catalog.now() then
      raise exception 'ends_at must be in the future' using errcode = '22023';
    end if;
    if set_status.ends_at > pg_catalog.now() + interval '7 days' then
      raise exception 'ends_at must be at most 7 days away (or null for "until I change it")'
        using errcode = '22023';
    end if;
  end if;

  -- TODO(NFR-SEC-9): rate-limit with the shared helper (agent A) once it lands.
  -- Each call writes a row and will send a Realtime signal to every viewer (WF-064).

  -- Serialise this user's status changes, so two concurrent calls can't both
  -- see "nothing active" and leave two open-ended statuses.
  perform 1 from public.users u where u.id = me for update;

  perform private.close_active_status(me);

  insert into public.status_overrides (user_id, status, label, starts_at, ends_at)
  values (me, set_status.status, clean_label, pg_catalog.now(), set_status.ends_at)
  returning * into result;

  return result;
end;
$$;

comment on function public.set_status(text, text, timestamptz) is
  'WF-063: sets the caller''s manual status from now until ends_at (null = until I change it), closing the previous one.';

revoke all on function public.set_status(text, text, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.set_status(text, text, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- public.clear_status(): ends the caller's current manual status now, so the
-- calendar-based status applies again. A no-op when none is active.
-- ---------------------------------------------------------------------------
create function public.clear_status() returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := public.current_user_id();
begin
  if me is null then
    raise exception 'User profile not found: call ensure_current_user first'
      using errcode = 'P0002';
  end if;

  perform 1 from public.users u where u.id = me for update;
  perform private.close_active_status(me);
end;
$$;

comment on function public.clear_status() is
  'WF-063: ends the caller''s current manual status now.';

revoke all on function public.clear_status() from public, anon, authenticated, service_role;
grant execute on function public.clear_status() to authenticated;

-- ---------------------------------------------------------------------------
-- private.purge_expired_status_overrides(retention): deletes overrides that
-- ended more than `retention` ago (default 7 days) and returns how many. For
-- the cleanup cron (WF-037), which runs as postgres; clients can't call it.
-- Ended overrides no longer affect any status now or later.
-- ---------------------------------------------------------------------------
create function private.purge_expired_status_overrides(retention interval default interval '7 days')
returns integer
language plpgsql
set search_path = ''
as $$
declare
  deleted integer;
begin
  if retention is null or retention < interval '0' then
    raise exception 'retention must be a non-negative interval' using errcode = '22023';
  end if;

  delete from public.status_overrides o
  where o.ends_at is not null
    and o.ends_at < pg_catalog.now() - retention;
  get diagnostics deleted = row_count;
  return deleted;
end;
$$;

revoke all on function private.purge_expired_status_overrides(interval) from public;

-- ---------------------------------------------------------------------------
-- Privileges and RLS: the owner reads their own overrides; nobody writes
-- directly.
-- ---------------------------------------------------------------------------
alter table public.status_overrides enable row level security;

revoke all on table public.status_overrides from anon, authenticated;
grant select on table public.status_overrides to authenticated;

create policy status_overrides_select_own on public.status_overrides
  for select to authenticated
  using (user_id = (select public.current_user_id()));

commit;
