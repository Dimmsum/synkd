-- WF-130: every user has a handle, generated from their name when the
-- account is created (FR-AUTH-2, D47).
--
--   * private.handle_base(name): the name as a handle: accents dropped,
--     lowercased, ASCII letters and digits only, no leading digits, no
--     "whosfree", at most 20 characters; 'user' when nothing is left.
--   * private.assign_generated_handle(user_id): gives a user a free handle:
--     the base, then the base with a random 2-, 4- or 6-digit number. A
--     candidate that is taken (also in a race with another sign-up) or
--     reserved is skipped, so the users CHECK constraints and unique index
--     stay the only definition of a valid handle.
--   * ensure_current_user() assigns one to the row it creates.
--   * set_handle() can still change it, but no longer clears it (WF101).
--   * Existing users without a handle are given one.

-- ---------------------------------------------------------------------------
-- private.handle_base(name). Immutable and pure, so it can be tested alone.
-- ---------------------------------------------------------------------------
create function private.handle_base(name text) returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  base text := pg_catalog.regexp_replace(
    pg_catalog.lower(
      pg_catalog.translate(
        coalesce(handle_base.name, ''),
        'ÀÁÂÃÄÅàáâãäåÇçÈÉÊËèéêëÌÍÎÏìíîïÑñÒÓÔÕÖØòóôõöøÙÚÛÜùúûüÝýÿ',
        'AAAAAAaaaaaaCcEEEEeeeeIIIIiiiiNnOOOOOOooooooUUUUuuuuYyy'
      )
    ),
    '[^a-z0-9]', '', 'g'
  );
begin
  -- Removing one occurrence can join the letters around it into another.
  while pg_catalog.strpos(base, 'whosfree') > 0 loop
    base := pg_catalog.replace(base, 'whosfree', '');
  end loop;
  base := pg_catalog.left(pg_catalog.regexp_replace(base, '^[0-9]+', ''), 20);
  return coalesce(nullif(base, ''), 'user');
end;
$$;

revoke all on function private.handle_base(text) from public;

-- ---------------------------------------------------------------------------
-- private.assign_generated_handle(user_id): sets a generated handle on that
-- user and returns it. Never raises over the handle, so it can't block a
-- sign-up: after 50 failed candidates (all but impossible) it leaves the
-- handle null and returns null. Called by security definer functions and
-- the backfill below, which can see every handle.
-- ---------------------------------------------------------------------------
create function private.assign_generated_handle(user_id uuid) returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  base text;
  candidate text;
  n integer;
begin
  select private.handle_base(u.name) into base
  from public.users u
  where u.id = assign_generated_handle.user_id;
  if base is null then
    return null;
  end if;

  for n in 0..49 loop
    candidate := case
      when n = 0 then base
      when n <= 10 then base || (10 + pg_catalog.floor(pg_catalog.random() * 90))::integer::text
      when n <= 30 then base || (1000 + pg_catalog.floor(pg_catalog.random() * 9000))::integer::text
      else base || (100000 + pg_catalog.floor(pg_catalog.random() * 900000))::integer::text
    end;
    -- Too short ('al' becomes 'al42'), or taken: no need to try the update.
    continue when pg_catalog.char_length(candidate) < 3 or exists (
      select 1 from public.users u
      where u.handle is not null and pg_catalog.lower(u.handle) = candidate
    );
    begin
      update public.users u set handle = candidate where u.id = assign_generated_handle.user_id;
      return candidate;
    exception
      -- Taken since the check (users_handle_lower_key), or reserved
      -- (users_handle_not_reserved: 'admin', 'support', ...): try another.
      when unique_violation or check_violation then
        null;
    end;
  end loop;
  return null;
end;
$$;

revoke all on function private.assign_generated_handle(uuid) from public;

-- ---------------------------------------------------------------------------
-- public.ensure_current_user(name, avatar_url, timezone): as in WF-004
-- (20261001300000_ensure_current_user.sql), and the row it creates gets a
-- generated handle (D47). An existing row is still returned unchanged.
-- ---------------------------------------------------------------------------
create or replace function public.ensure_current_user(
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

  if found then
    -- D47: only the call that created the row. A concurrent first call waits
    -- for this transaction and then reads the row with its handle.
    perform private.assign_generated_handle(result.id);
  end if;
  select * into result from public.users u where u.clerk_id = clerk_sub;
  return result;
end;
$$;

comment on function public.ensure_current_user(text, text, text) is
  'WF-004: returns the caller''s users row, creating it (with its default availability_prefs and a handle generated from the name, D47) on first sign-in. The Clerk ID comes only from the token. Idempotent: never changes an existing row.';

-- ---------------------------------------------------------------------------
-- public.set_handle(handle): as in WF-040 (20261001100100_profiles_and_handles.sql),
-- except that null or '' is refused (WF101) instead of clearing the handle:
-- every user keeps one (D47).
-- ---------------------------------------------------------------------------
create or replace function public.set_handle(handle text) returns text
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
  if new_handle is null then
    raise exception 'Choose a handle' using errcode = 'WF101';
  end if;

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
  'WF-040/D47: sets or changes the caller''s handle; it can''t be cleared. Errors WF101 invalid or empty, WF102 reserved, WF103 taken, PT429 rate limited.';

-- ---------------------------------------------------------------------------
-- Backfill: existing users without a handle get one. One update per row, so
-- each sees the handles given before it.
-- ---------------------------------------------------------------------------
do $$
declare
  missing uuid;
begin
  for missing in
    select u.id from public.users u where u.handle is null order by u.created_at, u.id
  loop
    perform private.assign_generated_handle(missing);
  end loop;
end;
$$;
