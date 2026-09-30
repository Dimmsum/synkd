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
