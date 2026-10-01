-- WF-042: friend invite links (FR-SOC-1, FR-SOC-3, FR-SOC-6, FR-VIS-1,
-- FR-WEB-3, NFR-SEC-2, NFR-SEC-9, D20, D41, D43).
--
-- A friend invite is a row in `invites` without a group: a revocable link
-- (/i/<code>) that lets whoever opens it send its creator a friend request,
-- choosing the tier the creator will see (T1 by default). Unlike the plain
-- friend link /add/<user id> (which keeps working), it can be shared with
-- people who aren't on whosfree yet (the code survives sign-up through the
-- wf_invite cookie, WF-045) and it can be turned off or replaced.
--
-- Each user has at most one live friend link. It never expires and has no use
-- limit (a personal link, like a QR code); `uses` counts the requests it
-- produced. Replacing it (regenerate) or turning it off (revoke) makes the old
-- code stop working at once.
--
--   get_my_friend_invite()                the caller's live link, if any
--   create_friend_invite()                the caller's live link, made if missing
--   regenerate_friend_invite()            turns the old link off, makes a new one
--   revoke_friend_invite()                turns the link off
--   get_friend_invite_summary(code)       public: status and inviter's name (anon)
--   preview_friend_invite(code)           signed in: the inviter's public profile
--   request_friend_by_invite(code, tier)  sends the inviter a friend request
--
-- Group invite functions are unchanged: they already treat an invite without a
-- group as "not found" (private.invite_status returns null for it).
--
-- Blocks (FR-SOC-6, D43) are applied both ways, the same as get_profile: a
-- signed-in caller blocked either way gets no summary and no preview (exactly
-- as for a code that doesn't exist), and a request through the link fails
-- with "Invite not found" if the inviter blocked the caller, or WF206 if the
-- caller blocked the inviter (only the blocker ever sees that). Anonymous
-- visitors see only the inviter's display name, like a group invite page:
-- never an id, handle or avatar.
--
-- Rate limits (NFR-SEC-9): new links 10 a day ('friend_invite', shared by
-- create and regenerate; returning the existing link is free). Requests go
-- through private.send_friend_request, so the friend request limits apply
-- (20 a day, 3 a week to the same person).

-- ---------------------------------------------------------------------------
-- Schema: allow invites without a group, but only as friend links.
-- ---------------------------------------------------------------------------
alter table public.invites drop constraint invites_group_required;

-- A friend link never expires and has no use limit.
alter table public.invites
  add constraint invites_friend_link_unlimited
  check (group_id is not null or (expires_at is null and max_uses is null));

-- At most one live friend link per user (create/regenerate also serialise on
-- the user's row; this guards any other write path).
create unique index invites_one_live_friend_link_key
  on public.invites (inviter_id)
  where group_id is null and not revoked;

comment on table public.invites is
  'Invite links (PRD §9, FR-SOC-3): group invites, and friend links (group_id null, WF-042). Not readable by clients: codes are returned only by the invite functions.';

-- ---------------------------------------------------------------------------
-- The shape create/regenerate/get_my_friend_invite return (a named type, like
-- public.group_invite, so OUT columns can't clash with table columns).
-- ---------------------------------------------------------------------------
create type public.friend_invite as (
  id uuid,
  code text,
  uses integer,
  created_at timestamptz
);

create function private.to_friend_invite(invite public.invites)
returns public.friend_invite
language sql
immutable
set search_path = ''
as $$
  select row(invite.id, invite.code, invite.uses, invite.created_at)::public.friend_invite
$$;

revoke all on function private.to_friend_invite(public.invites) from public;

-- Locks `owner`'s users row, so their friend-link changes run one at a time.
create function private.lock_user(owner uuid) returns void
language plpgsql
volatile
set search_path = ''
as $$
begin
  perform 1 from public.users u where u.id = lock_user.owner for update;
end;
$$;

revoke all on function private.lock_user(uuid) from public;

-- ---------------------------------------------------------------------------
-- public.get_my_friend_invite(): the caller's live friend link (zero or one
-- row).
-- ---------------------------------------------------------------------------
create function public.get_my_friend_invite()
returns setof public.friend_invite
language sql
stable
security definer
set search_path = ''
as $$
  select private.to_friend_invite(i)
  from public.invites i
  where i.inviter_id = public.current_user_id()
    and i.group_id is null
    and not i.revoked
$$;

comment on function public.get_my_friend_invite() is
  'WF-042: the caller''s live friend invite link, if they have one.';

revoke all on function public.get_my_friend_invite() from public, anon, authenticated, service_role;
grant execute on function public.get_my_friend_invite() to authenticated;

-- ---------------------------------------------------------------------------
-- public.create_friend_invite(): the caller's live friend link, created if
-- they have none. Idempotent: returning the existing link costs nothing.
-- ---------------------------------------------------------------------------
create function public.create_friend_invite()
returns public.friend_invite
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := private.require_user();
  invite public.invites;
begin
  perform private.lock_user(me);

  select * into invite
  from public.invites i
  where i.inviter_id = me and i.group_id is null and not i.revoked;
  if found then
    return private.to_friend_invite(invite);
  end if;

  perform private.consume_rate_limit(me, 'friend_invite', 10, interval '1 day');

  insert into public.invites (code, inviter_id)
  values (private.new_invite_code(), me)
  returning * into invite;
  return private.to_friend_invite(invite);
end;
$$;

comment on function public.create_friend_invite() is
  'WF-042: the caller''s friend invite link, created if missing (10 new links a day).';

revoke all on function public.create_friend_invite() from public, anon, authenticated, service_role;
grant execute on function public.create_friend_invite() to authenticated;

-- ---------------------------------------------------------------------------
-- public.regenerate_friend_invite(): turns the caller's live friend link off
-- (if any) and returns a new one. Shares the 10-a-day allowance with create.
-- ---------------------------------------------------------------------------
create function public.regenerate_friend_invite()
returns public.friend_invite
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := private.require_user();
  invite public.invites;
begin
  perform private.lock_user(me);
  perform private.consume_rate_limit(me, 'friend_invite', 10, interval '1 day');

  update public.invites i
  set revoked = true
  where i.inviter_id = me and i.group_id is null and not i.revoked;

  insert into public.invites (code, inviter_id)
  values (private.new_invite_code(), me)
  returning * into invite;
  return private.to_friend_invite(invite);
end;
$$;

comment on function public.regenerate_friend_invite() is
  'WF-042: replaces the caller''s friend invite link with a new code; the old one stops working.';

revoke all on function public.regenerate_friend_invite()
  from public, anon, authenticated, service_role;
grant execute on function public.regenerate_friend_invite() to authenticated;

-- ---------------------------------------------------------------------------
-- public.revoke_friend_invite(): turns the caller's friend link off.
-- Idempotent, never rate-limited.
-- ---------------------------------------------------------------------------
create function public.revoke_friend_invite()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := private.require_user();
begin
  perform private.lock_user(me);
  update public.invites i
  set revoked = true
  where i.inviter_id = me and i.group_id is null and not i.revoked;
end;
$$;

comment on function public.revoke_friend_invite() is
  'WF-042: turns the caller''s friend invite link off. Idempotent.';

revoke all on function public.revoke_friend_invite() from public, anon, authenticated, service_role;
grant execute on function public.revoke_friend_invite() to authenticated;

-- ---------------------------------------------------------------------------
-- private.find_friend_invite(code): the friend invite with this code, or null
-- (malformed code, unknown code, or a group invite).
-- ---------------------------------------------------------------------------
create function private.find_friend_invite(code text)
returns public.invites
language plpgsql
stable
set search_path = ''
as $$
declare
  invite public.invites;
begin
  if code is null or code !~ '^[A-Za-z0-9_-]{22}$' then
    return null;
  end if;
  select * into invite
  from public.invites i
  where i.code = find_friend_invite.code and i.group_id is null;
  if not found then
    return null;
  end if;
  return invite;
end;
$$;

revoke all on function private.find_friend_invite(text) from public;

-- ---------------------------------------------------------------------------
-- public.get_friend_invite_summary(code): what the public invite page
-- /i/[code] may show about a friend link, signed in or not (FR-WEB-3).
--
-- No rows for a code that isn't a friend link, or when a signed-in caller and
-- the inviter have blocked each other (either way). Otherwise one row:
--   status        'valid' or 'revoked';
--   inviter_name  the inviter's display name while the link works, else null.
-- Nothing else: no id, handle or avatar.
--
-- TODO(NFR-SEC-9): callable by anon, so there is no user to limit; the
-- /i/[code] route is to be rate-limited per IP (as for get_invite_summary).
-- ---------------------------------------------------------------------------
create function public.get_friend_invite_summary(code text)
returns table (status text, inviter_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  invite public.invites := private.find_friend_invite(get_friend_invite_summary.code);
  viewer uuid := public.current_user_id();
begin
  if invite.id is null then
    return;
  end if;
  if viewer is not null and private.is_blocked(viewer, invite.inviter_id) then
    return;
  end if;
  if invite.revoked then
    return query select 'revoked'::text, null::text;
    return;
  end if;
  return query
    select 'valid'::text, u.name
    from public.users u
    where u.id = invite.inviter_id;
end;
$$;

comment on function public.get_friend_invite_summary(text) is
  'WF-042: the public summary of a friend invite link for /i/[code]: status, and while it works the inviter''s name. Nothing for unknown codes or across a block.';

revoke all on function public.get_friend_invite_summary(text)
  from public, anon, authenticated, service_role;
grant execute on function public.get_friend_invite_summary(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- public.preview_friend_invite(code): for a signed-in caller, the inviter's
-- public profile (id, name, handle, avatar) and how they relate to the caller,
-- so /join/[code] can show who they're adding and offer the tier picker.
--
-- No rows when the code isn't a friend link, the caller has no account yet, or
-- either has blocked the other (through private.visible_profile, the one
-- place other users' profiles are read). A turned-off link returns
-- status 'revoked' and nothing else.
-- ---------------------------------------------------------------------------
create function public.preview_friend_invite(code text)
returns table (
  status text,
  user_id uuid,
  name text,
  handle text,
  avatar_url text,
  relationship text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  invite public.invites := private.find_friend_invite(preview_friend_invite.code);
  viewer uuid := public.current_user_id();
begin
  if viewer is null or invite.id is null then
    return;
  end if;
  if private.is_blocked(viewer, invite.inviter_id) then
    return;
  end if;
  if invite.revoked then
    return query
      select 'revoked'::text, null::uuid, null::text, null::text, null::text, null::text;
    return;
  end if;
  return query
    select 'valid'::text, p.id, p.name, p.handle, p.avatar_url, p.relationship
    from private.visible_profile(viewer, invite.inviter_id) p;
end;
$$;

comment on function public.preview_friend_invite(text) is
  'WF-042: the inviter''s public profile and relationship for a friend invite link; nothing across a block.';

revoke all on function public.preview_friend_invite(text)
  from public, anon, authenticated, service_role;
grant execute on function public.preview_friend_invite(text) to authenticated;

-- ---------------------------------------------------------------------------
-- public.request_friend_by_invite(code, tier): sends the link's creator a
-- friend request with the tier they will see once they accept (FR-VIS-1, T1
-- by default), through private.send_friend_request (same checks, limits and
-- mutual auto-accept). Returns one row: `status` 'pending' or 'accepted'
-- (they had already asked the caller), and `user_id`, the inviter, who may be
-- notified (the caller's request to them was just authorised here).
--
-- Errors: P0002 'Invite not found' (unknown code, or the inviter blocked the
-- caller); P0001 'This invite has been revoked'; WF202 your own link; WF203
-- already friends; WF204 request already sent; WF206 you blocked them; PT429.
-- ---------------------------------------------------------------------------
create function public.request_friend_by_invite(code text, tier integer default 1)
returns table (status text, user_id uuid)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := private.require_user();
  chosen smallint := private.check_tier(request_friend_by_invite.tier);
  found_invite public.invites := private.find_friend_invite(request_friend_by_invite.code);
  invite public.invites;
  outcome text;
begin
  if found_invite.id is null then
    raise exception 'Invite not found' using errcode = 'P0002';
  end if;

  -- Re-read under a row lock, so revoking and counting uses are serialised.
  select * into invite from public.invites i where i.id = found_invite.id for update;

  if exists (
    select 1 from public.blocks bl
    where bl.blocker_id = invite.inviter_id and bl.blocked_id = me
  ) then
    raise exception 'Invite not found' using errcode = 'P0002';
  end if;
  if invite.revoked then
    raise exception 'This invite has been revoked' using errcode = 'P0001';
  end if;

  outcome := private.send_friend_request(me, invite.inviter_id, chosen);

  update public.invites i set uses = i.uses + 1 where i.id = invite.id;

  return query select outcome, invite.inviter_id;
end;
$$;

comment on function public.request_friend_by_invite(text, integer) is
  'WF-042: sends a friend request to a friend invite link''s creator with the chosen tier. Returns pending/accepted and the inviter''s id.';

revoke all on function public.request_friend_by_invite(text, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.request_friend_by_invite(text, integer) to authenticated;
