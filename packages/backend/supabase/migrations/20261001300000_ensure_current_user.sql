-- WF-004: create the signed-in user's `users` row on first sign-in (PRD §9,
-- FR-AUTH-2, FR-AUTH-3, D19, D41).
--
-- Clients have no INSERT privilege on `users` (WF-003). The web app calls
-- `ensure_current_user()` with the user's Clerk session token (from the
-- browser, or from the Next.js server acting as the user) after sign-in. The
-- Clerk user ID comes only from the verified token (`auth.jwt() ->> 'sub'`),
-- never from an argument, so nobody can create or claim someone else's row.
-- Clerk session tokens must carry `role: "authenticated"` so PostgREST runs
-- the request as `authenticated`, the only role allowed to call this.
--
-- No Clerk webhook path is added: the first-request call covers creation, and
-- a webhook would race it (a row created by `user.created` has no detected
-- timezone, and the idempotent call below would then keep the webhook's
-- default). Profile edits belong to the app after creation, so `user.updated`
-- should not overwrite them, and `user.deleted` must go through account
-- deletion (WF-114), which hands over group admin roles first.

-- ---------------------------------------------------------------------------
-- public.ensure_current_user(name, avatar_url, timezone): the caller's users
-- row, created on the first call.
--
--   * Idempotent: if the caller already has a row it is returned unchanged,
--     whatever the arguments (so a later sign-in never overwrites a profile
--     the user has edited). The arguments are validated only when creating.
--   * name: trimmed, 1-100 characters, no control characters.
--   * avatar_url: null, empty (= null) or an https URL of at most 2048
--     characters (Clerk's Google avatar URLs are https).
--   * timezone: an IANA name; null or empty means America/Jamaica
--     (FR-AUTH-3). Unknown names are rejected by the users timezone trigger.
--   * Concurrent first calls (two tabs) are safe: the insert does nothing on
--     a clerk_id conflict and the existing row is returned.
--   * The default `availability_prefs` row (WF-062) is created by a trigger on
--     users, in the same transaction.
--
-- security definer because clients can't insert into users. It only ever
-- writes the row for the token's own `sub`.
-- ---------------------------------------------------------------------------
create function public.ensure_current_user(
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

  if not found then
    select * into result from public.users u where u.clerk_id = clerk_sub;
  end if;
  return result;
end;
$$;

comment on function public.ensure_current_user(text, text, text) is
  'WF-004: returns the caller''s users row, creating it (and its default availability_prefs) on first sign-in. The Clerk ID comes only from the token. Idempotent: never changes an existing row.';

revoke all on function public.ensure_current_user(text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.ensure_current_user(text, text, text) to authenticated;
