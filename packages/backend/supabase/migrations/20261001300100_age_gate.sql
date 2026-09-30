-- WF-005: the 18+ age gate (FR-AUTH-6, NFR-COMP-7, D13, D29).
--
-- The full date of birth never reaches the database. The Next.js server checks
-- it with `checkAge()` from @whosfree/shared (exact to the day, against today's
-- date in America/Jamaica), then calls `confirm_age(birth_year)` with the
-- user's own Clerk token. Only the birth year and the confirmation time are
-- stored.
--
-- Why `authenticated` may call it rather than only the service role: the check
-- is self-declared (D29), so a client calling the function directly with a
-- made-up year is no less trustworthy than one typing a made-up date of birth
-- into the form. Keeping it a user-token call means the server needs no
-- service-role key for sign-up (D41: service role for background work only)
-- and the function can take the user from the token instead of an argument.
-- It still refuses any year that can't belong to an adult.
--
-- The confirmation is permanent: once set, the birth year and time can't be
-- changed by the user, and a trigger stops any role (even the service role)
-- from changing them by mistake. Under-18 reports are handled by suspension
-- and deletion (FR-AUTH-6), not by editing the year.

alter table public.users
  add constraint users_age_confirmation_complete
  check ((birth_year is null) = (age_confirmed_at is null));

-- ---------------------------------------------------------------------------
-- Write-once guard on birth_year and age_confirmed_at.
-- ---------------------------------------------------------------------------
create function private.protect_age_confirmation() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.age_confirmed_at is not null
    and (
      new.birth_year is distinct from old.birth_year
      or new.age_confirmed_at is distinct from old.age_confirmed_at
    )
  then
    raise exception 'birth_year and age_confirmed_at are write-once (the age is already confirmed)'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

revoke all on function private.protect_age_confirmation() from public;

create trigger users_protect_age_confirmation
  before update of birth_year, age_confirmed_at on public.users
  for each row execute function private.protect_age_confirmation();

-- ---------------------------------------------------------------------------
-- public.confirm_age(birth_year): records the caller's birth year and the
-- confirmation time. Returns age_confirmed_at.
--
--   * The caller must have a users row (ensure_current_user first).
--   * birth_year must be 1900 or later and at most (latest calendar year
--     anywhere on Earth right now, i.e. in UTC+14) - 18: a necessary condition
--     for being 18 today in any timezone. The exact, to-the-day check is
--     checkAge() on the server, which is the only place the full date exists.
--   * Once confirmed, a repeat call with the same year returns the original
--     confirmation time unchanged (safe to retry); a different year is refused.
--
-- security definer because clients can't write birth_year or age_confirmed_at.
-- ---------------------------------------------------------------------------
create function public.confirm_age(birth_year integer)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := public.current_user_id();
  latest_adult_year integer :=
    pg_catalog.date_part('year', pg_catalog.now() at time zone 'Pacific/Kiritimati')::integer - 18;
  stored_year smallint;
  stored_at timestamptz;
begin
  if me is null then
    raise exception 'User profile not found: call ensure_current_user first'
      using errcode = 'P0002';
  end if;

  if confirm_age.birth_year is null
    or confirm_age.birth_year not between 1900 and latest_adult_year
  then
    raise exception 'Birth year must be between 1900 and % (18 or over)', latest_adult_year
      using errcode = '22023';
  end if;

  select u.birth_year, u.age_confirmed_at into stored_year, stored_at
  from public.users u
  where u.id = me
  for update;

  if stored_at is not null then
    if stored_year = confirm_age.birth_year then
      return stored_at;
    end if;
    raise exception 'Age is already confirmed; the birth year can''t be changed'
      using errcode = '55000';
  end if;

  update public.users
  set birth_year = confirm_age.birth_year, age_confirmed_at = pg_catalog.now()
  where id = me;

  return pg_catalog.now();
end;
$$;

comment on function public.confirm_age(integer) is
  'WF-005: records the caller''s birth year and age_confirmed_at, once. The full date of birth is checked on the server (checkAge in @whosfree/shared) and never stored.';

revoke all on function public.confirm_age(integer) from public, anon, authenticated, service_role;
grant execute on function public.confirm_age(integer) to authenticated;
