-- WF-062: available hours and the other availability settings (PRD §9
-- `availabilityPrefs`, FR-AVL-2, FR-AVL-8, FR-GCAL-6, D24).
--
-- One row per user, created with the users row (trigger below) so every user
-- always has one, with the D24 default of 08:00-22:00 every day.
--
-- `weekly` is a jsonb array in exactly the shape of `AvailableHours[]` from
-- @whosfree/shared, `[{"day": "mon", "start": "08:00", "end": "22:00"}, ...]`,
-- rather than a child table:
--   * it is what the availability engine takes (`availableHours`), so readers
--     (the owner's settings page now, the Now function WF-064 and the slot
--     finder later) pass it through with no join or aggregation;
--   * a week is read and replaced as one value in one row, so there is no
--     half-updated week and no per-day rows to keep in step;
--   * the trigger below validates it as strictly as table constraints would
--     (known days, HH:MM, end after start, one window per day, no extra keys)
--     and stores it in a canonical order (mon..sun).
-- A day with no entry means "not available that day" (away all day), which
-- the engine supports; an empty array means always away.
--
-- Only the owner can read or change their row (RLS). Other users' hours are
-- not selectable; WF-064 will read them inside its security definer function.

create table public.availability_prefs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  weekly jsonb not null default '[
    {"day": "mon", "start": "08:00", "end": "22:00"},
    {"day": "tue", "start": "08:00", "end": "22:00"},
    {"day": "wed", "start": "08:00", "end": "22:00"},
    {"day": "thu", "start": "08:00", "end": "22:00"},
    {"day": "fri", "start": "08:00", "end": "22:00"},
    {"day": "sat", "start": "08:00", "end": "22:00"},
    {"day": "sun", "start": "08:00", "end": "22:00"}
  ]'::jsonb,
  -- FR-AVL-8: gaps shorter than this count as busy. Up to 4 hours.
  min_gap_minutes smallint not null default 15 check (min_gap_minutes between 0 and 240),
  -- FR-GCAL-6: whether all-day Google events make the user busy.
  count_all_day_events boolean not null default false,
  created_at timestamptz not null default now(),
  constraint availability_prefs_user_id_key unique (user_id)
);

comment on table public.availability_prefs is
  'One row per user (PRD §9 availabilityPrefs). weekly is AvailableHours[] from @whosfree/shared, validated and ordered by trigger. Owner-only under RLS.';

-- ---------------------------------------------------------------------------
-- Validates `weekly` and rewrites it in canonical form: entries ordered
-- mon..sun, each exactly {day, start, end}. Raises 22023 with a specific
-- message for each problem.
-- ---------------------------------------------------------------------------
create function private.validate_weekly_hours() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  days constant text[] := array['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  entry jsonb;
  seen text[] := '{}';
  entry_day text;
  entry_start text;
  entry_end text;
begin
  if new.weekly is null or jsonb_typeof(new.weekly) <> 'array' then
    raise exception 'Available hours must be an array of {day, start, end}'
      using errcode = '22023';
  end if;

  for entry in select e.value from jsonb_array_elements(new.weekly) e loop
    if jsonb_typeof(entry) <> 'object'
      or (select array_agg(k order by k) from jsonb_object_keys(entry) k)
        is distinct from array['day', 'end', 'start']
      or jsonb_typeof(entry -> 'day') <> 'string'
      or jsonb_typeof(entry -> 'start') <> 'string'
      or jsonb_typeof(entry -> 'end') <> 'string'
    then
      raise exception 'Each available-hours entry must be exactly {day, start, end} with string values'
        using errcode = '22023';
    end if;

    entry_day := entry ->> 'day';
    entry_start := entry ->> 'start';
    entry_end := entry ->> 'end';

    if not (entry_day = any (days)) then
      raise exception 'Unknown day: %', entry_day using errcode = '22023';
    end if;
    if entry_day = any (seen) then
      raise exception 'Duplicate day: % (one window per day)', entry_day using errcode = '22023';
    end if;
    seen := seen || entry_day;

    if entry_start !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
      raise exception 'Invalid start time on %: % (expected HH:MM, 24-hour)', entry_day, entry_start
        using errcode = '22023';
    end if;
    if entry_end !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
      raise exception 'Invalid end time on %: % (expected HH:MM, 24-hour)', entry_day, entry_end
        using errcode = '22023';
    end if;
    -- Zero-padded HH:MM strings compare in time order.
    if entry_end <= entry_start then
      raise exception 'End must be after start on %: % to %', entry_day, entry_start, entry_end
        using errcode = '22023';
    end if;
  end loop;

  new.weekly := coalesce(
    (
      select jsonb_agg(
        jsonb_build_object('day', e.value ->> 'day', 'start', e.value ->> 'start', 'end', e.value ->> 'end')
        order by array_position(days, e.value ->> 'day')
      )
      from jsonb_array_elements(new.weekly) e
    ),
    '[]'::jsonb
  );
  return new;
end;
$$;

revoke all on function private.validate_weekly_hours() from public;

create trigger availability_prefs_validate_weekly
  before insert or update of weekly on public.availability_prefs
  for each row execute function private.validate_weekly_hours();

-- ---------------------------------------------------------------------------
-- Every new users row gets its default prefs row in the same transaction
-- (ensure_current_user, WF-004, and any server-side insert).
-- ---------------------------------------------------------------------------
create function private.create_default_availability_prefs() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  insert into public.availability_prefs (user_id) values (new.id);
  return null;
end;
$$;

revoke all on function private.create_default_availability_prefs() from public;

create trigger users_create_default_availability_prefs
  after insert on public.users
  for each row execute function private.create_default_availability_prefs();

-- Users created before this migration.
insert into public.availability_prefs (user_id)
select u.id from public.users u
on conflict (user_id) do nothing;

-- ---------------------------------------------------------------------------
-- Privileges and RLS: the owner reads and edits their own settings. Rows are
-- created by the trigger and deleted with the user, so no INSERT or DELETE.
-- ---------------------------------------------------------------------------
alter table public.availability_prefs enable row level security;

revoke all on table public.availability_prefs from anon, authenticated;
grant select on table public.availability_prefs to authenticated;
grant update (weekly, min_gap_minutes, count_all_day_events)
  on table public.availability_prefs to authenticated;

create policy availability_prefs_select_own on public.availability_prefs
  for select to authenticated
  using (user_id = (select public.current_user_id()));

create policy availability_prefs_update_own on public.availability_prefs
  for update to authenticated
  using (user_id = (select public.current_user_id()))
  with check (user_id = (select public.current_user_id()));

-- ---------------------------------------------------------------------------
-- public.set_day_hours(day, start_time, end_time): edits one day of the
-- caller's available hours (FR-AVL-2 "edit each day separately") and returns
-- the new week. Both times null = not available that day. The rest of the week
-- is untouched, and the change is one atomic UPDATE, so two edits to
-- different days can't overwrite each other.
--
-- Runs as the caller (not security definer): it's an ordinary UPDATE of the
-- caller's own row under RLS; the trigger validates the result.
-- ---------------------------------------------------------------------------
create function public.set_day_hours(
  day text,
  start_time text default null,
  end_time text default null
)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  result jsonb;
begin
  if set_day_hours.day is null
    or not (set_day_hours.day = any (array['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']))
  then
    raise exception 'Unknown day: %', coalesce(set_day_hours.day, 'NULL') using errcode = '22023';
  end if;
  if (set_day_hours.start_time is null) <> (set_day_hours.end_time is null) then
    raise exception 'Give both start and end times, or neither to mark the day unavailable'
      using errcode = '22023';
  end if;

  update public.availability_prefs p
  set weekly = coalesce(
      (
        select jsonb_agg(e.value)
        from jsonb_array_elements(p.weekly) e
        where e.value ->> 'day' <> set_day_hours.day
      ),
      '[]'::jsonb
    ) || case
      when set_day_hours.start_time is null then '[]'::jsonb
      else jsonb_build_array(
        jsonb_build_object(
          'day', set_day_hours.day,
          'start', set_day_hours.start_time,
          'end', set_day_hours.end_time
        )
      )
    end
  where p.user_id = public.current_user_id()
  returning p.weekly into result;

  if not found then
    raise exception 'User profile not found: call ensure_current_user first'
      using errcode = 'P0002';
  end if;
  return result;
end;
$$;

comment on function public.set_day_hours(text, text, text) is
  'WF-062: sets (or clears, with null times) one day of the caller''s available hours and returns the whole week.';

revoke all on function public.set_day_hours(text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.set_day_hours(text, text, text) to authenticated;
