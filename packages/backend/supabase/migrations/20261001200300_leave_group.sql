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
