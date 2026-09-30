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
