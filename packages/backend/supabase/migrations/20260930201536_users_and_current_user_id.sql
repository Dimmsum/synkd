-- WF-003: the `users` table and `current_user_id()` (PRD §9, D19, D40, D41).
--
-- Authorisation model (D41): Clerk signs users in and Supabase trusts Clerk's
-- session tokens through third-party auth. The Clerk user ID arrives in the
-- JWT `sub` claim (a text ID like `user_2abc...`, not a uuid, so `auth.uid()`
-- must not be used). `current_user_id()` maps it to `users.id`, and every RLS
-- policy keys on that.
--
-- Supabase grants ALL on new `public` tables and functions to `anon`,
-- `authenticated` and `service_role`, and Postgres grants EXECUTE on functions
-- to PUBLIC. Each object below therefore revokes what clients must not have
-- and grants back only what they need. RLS is the row filter on top.

-- ---------------------------------------------------------------------------
-- Private schema: helpers that clients must never call. It is not in the API's
-- exposed schemas (supabase/config.toml `[api] schemas`), and clients get no
-- USAGE on it. Functions here run only inside our security definer functions.
-- ---------------------------------------------------------------------------
create schema private;
revoke all on schema private from public;
alter default privileges for role postgres in schema private
  revoke execute on functions from public;

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
create table public.users (
  id uuid primary key default gen_random_uuid(),
  -- The Clerk user ID (JWT `sub`). Set once when the row is created (WF-004)
  -- and never changed by the user.
  clerk_id text not null unique check (char_length(clerk_id) between 1 and 255),
  name text not null check (char_length(name) between 1 and 100),
  -- Optional unique handle (`@kemar`). Format rules and reserved words are
  -- WF-040, which also decides how users set it; until then it is not
  -- client-writable. Uniqueness ignores case.
  handle text check (handle is null or char_length(handle) between 1 and 30),
  -- Only https URLs, so a client can't store a `javascript:` URL that another
  -- page might render.
  avatar_url text check (
    avatar_url is null or (avatar_url ~* '^https://' and char_length(avatar_url) <= 2048)
  ),
  -- IANA timezone name; validated by the trigger below.
  timezone text not null default 'America/Jamaica',
  -- FR-VIS-6: when true, other users see "Sharing paused" and no events.
  sharing_paused boolean not null default false,
  -- D29: only the birth year and a confirmation time; never the full date of
  -- birth. Written by the age gate (WF-005), not by the client.
  birth_year smallint check (birth_year between 1900 and 2100),
  age_confirmed_at timestamptz,
  -- WF-015: the accepted terms/privacy version. Written by the server.
  consent_version text check (consent_version is null or char_length(consent_version) <= 50),
  consent_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.users is
  'One row per person (PRD §9). Readable and partly updatable by its owner only; other users'' profiles are exposed only through security definer functions.';

create unique index users_handle_lower_key on public.users (lower(handle)) where handle is not null;

-- Reject anything that isn't a timezone name Postgres knows (e.g.
-- 'America/Jamaica'), so a bad value can't break time maths for the owner or
-- their viewers later. The shape check rules out POSIX-style specs such as
-- '<+05>-05' that Postgres accepts but JavaScript's Intl doesn't. (Looking the
-- name up in pg_timezone_names would be stricter but costs ~20 ms per call.)
create function private.validate_user_timezone() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  known boolean := true;
begin
  if new.timezone !~ '^[A-Za-z][A-Za-z0-9_+-]*(/[A-Za-z0-9_+-]+)*$' then
    known := false;
  else
    begin
      perform pg_catalog.now() at time zone new.timezone;
    exception when invalid_parameter_value then
      known := false;
    end;
  end if;
  if not known then
    raise exception 'Unknown timezone: %', new.timezone using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger users_validate_timezone
  before insert or update of timezone on public.users
  for each row execute function private.validate_user_timezone();

-- ---------------------------------------------------------------------------
-- current_user_id(): the signed-in user's `users.id`, or null.
--
-- security definer so it can read `users` without recursing into the users
-- RLS policy that calls it. It only ever returns the caller's own id.
-- ---------------------------------------------------------------------------
create function public.current_user_id() returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u.id
  from public.users u
  where u.clerk_id = (auth.jwt() ->> 'sub')
$$;

comment on function public.current_user_id() is
  'Maps the Clerk user ID in the JWT sub claim to users.id. Null when there is no token or no users row yet.';

revoke all on function public.current_user_id() from public, anon, authenticated, service_role;
grant execute on function public.current_user_id() to authenticated;

-- ---------------------------------------------------------------------------
-- users: privileges and RLS
--
-- Clients may read their own row and update only the profile fields they own.
-- `clerk_id`, `id`, `created_at`, the age gate fields, the consent fields and
-- (until WF-040) `handle` are not client-writable. Rows are created on first
-- sign-in by WF-004 (server-side), and deleted by account deletion (WF-114).
-- ---------------------------------------------------------------------------
alter table public.users enable row level security;

revoke all on table public.users from anon, authenticated;
grant select on table public.users to authenticated;
grant update (name, avatar_url, timezone, sharing_paused) on table public.users to authenticated;

create policy users_select_own on public.users
  for select to authenticated
  using (id = (select public.current_user_id()));

create policy users_update_own on public.users
  for update to authenticated
  using (id = (select public.current_user_id()))
  with check (id = (select public.current_user_id()));
