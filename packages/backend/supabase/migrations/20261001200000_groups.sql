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
