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
