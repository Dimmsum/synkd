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
