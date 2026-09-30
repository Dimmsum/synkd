-- ============================================================================
-- Supabase stand-in for DATABASE TESTS ONLY (PGlite). This is NOT a migration
-- and is never applied to a real Supabase project, which already provides all
-- of this itself.
--
-- It reproduces the parts of Supabase's platform setup that our migrations and
-- RLS policies rely on, including the permissive default grants, so the tests
-- prove that our own RLS policies and REVOKEs are what protect the data:
--
--   * roles `anon`, `authenticated`, `service_role` (the Data API switches to
--     one of these per request, based on the JWT's `role` claim).
--     `service_role` bypasses RLS, as on Supabase.
--   * `auth.jwt()`, `auth.uid()`, `auth.role()`, reading the verified JWT claims
--     from the `request.jwt.claims` setting exactly as Supabase's versions do.
--     With Clerk third-party auth, `sub` is a Clerk user ID such as
--     `user_2abc...`, not a uuid, so `auth.uid()` raises an error for Clerk
--     tokens. Our SQL uses `auth.jwt() ->> 'sub'` via `current_user_id()`.
--   * Supabase's default privileges: everything `postgres` creates in `public`
--     is granted to anon, authenticated and service_role. Postgres itself
--     grants EXECUTE on every new function to PUBLIC.
--
--   * the parts of Realtime's `realtime` schema our migrations use (WF-064):
--     `realtime.messages` with RLS on, `realtime.topic()` and a stub
--     `realtime.send()` that records each Broadcast as a row, so tests can
--     read what was sent. See the end of this file.
--
-- Not reproduced: the `authenticator` login role, PostgREST, the Realtime
-- server, Storage, the real `auth` schema tables, and `extensions`.
-- ============================================================================

create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;

create function auth.jwt() returns jsonb
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;

create function auth.uid() returns uuid
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

create function auth.role() returns text
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;

grant execute on function auth.jwt(), auth.uid(), auth.role() to anon, authenticated, service_role;

-- Supabase's default grants on the public schema.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all on functions to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all on sequences to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Realtime (WF-064). On Supabase, `realtime.messages` is a partitioned table
-- the Realtime server reads Broadcast messages from; `realtime.send()` inserts
-- one (and turns any error into a WARNING, so it never fails the caller's
-- transaction); and `realtime.topic()` is the channel topic Realtime sets
-- while it checks a client's RLS access to a private channel. Here messages
-- is a plain table, so every send is recorded for tests to read. Clients get
-- the same permissive grants as on Supabase: RLS policies decide.
-- ---------------------------------------------------------------------------
create schema realtime;
grant usage on schema realtime to anon, authenticated, service_role;

create table realtime.messages (
  id bigint generated always as identity primary key,
  topic text not null,
  extension text not null,
  payload jsonb,
  event text,
  private boolean default false,
  inserted_at timestamptz not null default now()
);
alter table realtime.messages enable row level security;
grant select, insert, update, delete on realtime.messages to anon, authenticated, service_role;

create function realtime.topic() returns text
language sql stable
as $$
  select nullif(current_setting('realtime.topic', true), '')::text
$$;

create function realtime.send(payload jsonb, event text, topic text, private boolean default true)
returns void
language plpgsql
as $$
begin
  begin
    perform set_config('realtime.topic', topic, true);
    insert into realtime.messages (payload, event, topic, private, extension)
    values (payload, event, topic, private, 'broadcast');
  exception
    when others then
      raise warning 'ErrorSendingBroadcastMessage: %', sqlerrm;
  end;
end;
$$;

grant execute on function realtime.topic(), realtime.send(jsonb, text, text, boolean)
  to anon, authenticated, service_role;
