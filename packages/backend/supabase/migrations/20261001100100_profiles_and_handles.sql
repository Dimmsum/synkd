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
