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
