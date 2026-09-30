-- WF-015: versioned consent record for the terms and privacy notice (FR-SET-5).
--
-- The current version lives in one SQL function, `current_consent_version()`,
-- rather than a config table:
--   * changing it is a migration, so it is reviewed and deployed together with
--     the new text in docs/legal, and nobody can bump it by accident from the
--     dashboard (which would force every user to re-accept);
--   * there is no table to grant, protect with RLS, or seed.
-- The terms and the privacy notice share one version (both docs carry the
-- same "Version" line), matching the single `users.consent_version` column.
-- To publish a new version: `create or replace` the function in a new
-- migration with the new string. Every user whose consent_version differs is
-- then asked to accept again (`account_status().consent_required`).
--
-- Users can't write consent_version or consent_at themselves (WF-003 column
-- grants); `accept_consent()` sets them, and only to the current version and
-- the server's clock, so a version can't be invented or a time backdated.

alter table public.users
  add constraint users_consent_complete
  check ((consent_version is null) = (consent_at is null));

-- ---------------------------------------------------------------------------
-- public.current_consent_version(): the terms/privacy version users must
-- accept. '0.1-draft' is the version on the current drafts in docs/legal;
-- publishing them (WF-010) replaces it.
-- ---------------------------------------------------------------------------
create function public.current_consent_version() returns text
language sql
stable
set search_path = ''
as $$
  select '0.1-draft'::text
$$;

comment on function public.current_consent_version() is
  'WF-015: the terms/privacy version users must have accepted. Changed only by a migration.';

revoke all on function public.current_consent_version()
  from public, anon, authenticated, service_role;
grant execute on function public.current_consent_version() to authenticated;

-- ---------------------------------------------------------------------------
-- public.accept_consent(version): records that the caller accepted `version`,
-- which must be the current version (the one the page showed them). Returns
-- consent_at.
--
--   * A stale or unknown version is refused, so a page left open across a
--     policy change can't record acceptance of text the user didn't see.
--   * Accepting the version already on record keeps the original consent_at.
--   * consent_at is always now(); it can't be supplied.
--
-- security definer because clients can't write the consent columns.
-- ---------------------------------------------------------------------------
create function public.accept_consent(version text)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := public.current_user_id();
  current_version text := public.current_consent_version();
  stored_version text;
  stored_at timestamptz;
begin
  if me is null then
    raise exception 'User profile not found: call ensure_current_user first'
      using errcode = 'P0002';
  end if;

  if accept_consent.version is distinct from current_version then
    raise exception 'Consent version % is not the current version (%)',
      coalesce(pg_catalog.quote_literal(accept_consent.version), 'NULL'), current_version
      using errcode = '22023';
  end if;

  select u.consent_version, u.consent_at into stored_version, stored_at
  from public.users u
  where u.id = me
  for update;

  if stored_version = current_version then
    return stored_at;
  end if;

  update public.users
  set consent_version = current_version, consent_at = pg_catalog.now()
  where id = me;

  return pg_catalog.now();
end;
$$;

comment on function public.accept_consent(text) is
  'WF-015: records consent_version and consent_at for the caller, only for the current version and at the server''s time.';

revoke all on function public.accept_consent(text) from public, anon, authenticated, service_role;
grant execute on function public.accept_consent(text) to authenticated;

-- ---------------------------------------------------------------------------
-- public.account_status(): what the web middleware needs to decide whether
-- the signed-in user may use app routes (WF-004, WF-005, WF-015). One row:
--
--   has_profile             the users row exists (else call ensure_current_user)
--   age_confirmed           the age gate is passed (WF-005)
--   consent_version         the version on record, or null
--   current_consent_version the version to show and accept
--   consent_required        true until the current version is accepted, and
--                           again whenever the version changes
--
-- The app is usable only when has_profile and age_confirmed are true and
-- consent_required is false. Runs as the caller (reads the own row under RLS).
-- ---------------------------------------------------------------------------
create function public.account_status()
returns table (
  has_profile boolean,
  age_confirmed boolean,
  consent_version text,
  current_consent_version text,
  consent_required boolean
)
language sql
stable
set search_path = ''
as $$
  select
    u.id is not null,
    u.age_confirmed_at is not null,
    u.consent_version,
    c.version,
    u.consent_version is distinct from c.version
  from (select public.current_consent_version() as version) c
  left join public.users u on u.id = public.current_user_id()
$$;

comment on function public.account_status() is
  'WF-004/005/015: whether the caller has a profile, has passed the age gate, and must (re-)accept the current terms/privacy version.';

revoke all on function public.account_status() from public, anon, authenticated, service_role;
grant execute on function public.account_status() to authenticated;
