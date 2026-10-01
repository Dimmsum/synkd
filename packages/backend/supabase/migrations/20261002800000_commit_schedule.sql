-- WF-030: commit a confirmed schedule to `sources` and `events` (PRD §8.5
-- step 7, §9 modelling decision; FR-IMP-7, FR-IMP-8, FR-IMP-12, FR-IMP-17,
-- NFR-SEC-7, NFR-SEC-9, D35, D38, D41, D42, D44). Used by manual entry
-- (WF-031) now and by the parse pipeline's Confirm (WF-027/029) later.
--
-- public.commit_schedule(draft, source_type, offline_friend_id) takes the
-- schedule as jsonb in the shape of `ScheduleCommit` from @whosfree/shared:
--
--   {"period": {"start": "2026-08-31", "end": "2026-12-12",
--               "exceptions": [{"start": "2026-10-19", "end": "2026-10-19",
--                               "label": "National Heroes Day"}]},
--    "events": [{"title": "COMP2140 Lecture", "category": "class",
--                "start": "10:00", "end": "12:00", "confidence": 1,
--                "when": {"kind": "weekly", "days": ["mon", "wed"],
--                         "pattern": {"type": "every"}}}]}
--
-- and checks it again here with the same rules (the client and the worker
-- check it with zod first), plus: unknown keys anywhere are rejected, so a
-- location, room or anything else can't be smuggled in (D35); at least one
-- event; the period at most 366 days with at most 50 exceptions; and every
-- event happens at least once in the period.
--
-- How it is stored (the same as eventTimesFromDraft in @whosfree/availability,
-- which the tests compare against):
--   * one `sources` row with the period (local dates, inclusive) and its
--     exceptions (breaks, holidays). Exceptions stay on the source rather
--     than becoming EXDATEs: the engine applies them when it expands the
--     source's events, as `now_for_viewer` does with the period it returns;
--   * one `events` row per draft event. Times are wall-clock times in the
--     owner's timezone (`users.timezone`; an offline friend's schedule uses
--     their owner's, D44), and starts_at/ends_at are the first occurrence;
--     an end before the start runs past midnight. A weekly event gets
--     `FREQ=WEEKLY;[INTERVAL=2;]WKST=MO;BYDAY=…;UNTIL=<last occurrence start>`
--     (the in-house subset, D42). UNTIL keeps the rule inside period_end,
--     which events_for_viewer relies on. Week numbers count from the
--     Monday–Sunday week containing the period's start (week 1, FR-IMP-5):
--     alternating weeks are INTERVAL=2 anchored on a week of the right
--     parity; specific weeks are the weekly rule up to the last chosen week
--     plus an EXDATE for every occurrence in a week that wasn't chosen. A
--     dated event (FR-IMP-6) is a one-off row inside the period.
--   * Local times are turned into instants by private.local_to_utc, which
--     resolves DST exactly as the engine does (a skipped time moves later, a
--     repeated time means the first one). Postgres's own `at time zone`
--     picks the second one for a repeated time, so it isn't used directly.
--
-- Replacing a schedule (FR-IMP-17; the "end on a date you pick" and keeping
-- history parts are WF-033): committing deletes the target's previous
-- upload and manual sources, with their events, in the same transaction, so
-- the user (or that offline friend) has exactly one confirmed schedule.
-- Google Calendar sources are never touched. The target is the caller's own
-- schedule (offline_friend_id null) or one of their offline friends (WF-127);
-- the two never replace each other.
--
-- Errors (DB_ERROR in packages/backend/src/errors.ts): WF001 no account for
-- this sign-in, WF401 the draft breaks a rule (a client bug: the apps check
-- it first), WF402 an event never happens in the period (`detail` is
-- {"event": <0-based index>}), P0002 'Offline friend not found' (also for
-- another user's), 22023 a bad source_type, PT429 more than 20 commits a day.
-- Messages name the field (e.g. `events[3].start`), never what was typed, so
-- they are safe to log (NFR-SEC-11).

-- ---------------------------------------------------------------------------
-- private.local_to_utc(local_ts, tz): the instant at which the wall clock in
-- `tz` shows `local_ts`. Same as localToUtc in @whosfree/availability:
-- the offsets a day either side are the only candidates; in a fall-back
-- overlap both are valid and the earlier wins; in a spring-forward gap
-- neither is, and the time is read with the pre-transition offset, which
-- lands after the gap (02:30 becomes 03:30).
-- ---------------------------------------------------------------------------
create function private.local_to_utc(local_ts timestamp, tz text) returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  before_offset interval :=
    ((local_ts - interval '1 day') at time zone 'UTC' at time zone tz) - (local_ts - interval '1 day');
  after_offset interval :=
    ((local_ts + interval '1 day') at time zone 'UTC' at time zone tz) - (local_ts + interval '1 day');
  with_before timestamptz := (local_ts - before_offset) at time zone 'UTC';
  with_after timestamptz := (local_ts - after_offset) at time zone 'UTC';
  before_valid boolean;
  after_valid boolean;
begin
  if before_offset = after_offset then
    return with_before;
  end if;
  before_valid := (with_before at time zone tz) = local_ts;
  after_valid := (with_after at time zone tz) = local_ts;
  if before_valid and after_valid then
    return least(with_before, with_after);
  elsif after_valid then
    return with_after;
  end if;
  return with_before;
end;
$$;

revoke all on function private.local_to_utc(timestamp, text) from public;

-- ---------------------------------------------------------------------------
-- Draft checks. Each raises WF401 naming the field (`what`).
-- ---------------------------------------------------------------------------

-- `value` must be a JSON object whose keys are all in `allowed`.
create function private.schedule_check_keys(value jsonb, allowed text[], what text) returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if value is null or pg_catalog.jsonb_typeof(value) <> 'object' then
    raise exception 'Invalid schedule: % must be an object', what using errcode = 'WF401';
  end if;
  if exists (select 1 from pg_catalog.jsonb_object_keys(value) k where k <> all (allowed)) then
    raise exception 'Invalid schedule: % has an unknown field', what using errcode = 'WF401';
  end if;
end;
$$;

revoke all on function private.schedule_check_keys(jsonb, text[], text) from public;

-- A `YYYY-MM-DD` string that is a real date (LocalDate in @whosfree/shared).
create function private.schedule_date(value jsonb, what text) returns date
language plpgsql
stable
set search_path = ''
as $$
declare
  raw text := value #>> '{}';
  parsed date;
begin
  if value is null or pg_catalog.jsonb_typeof(value) <> 'string'
    or raw !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'Invalid schedule: % must be a YYYY-MM-DD date', what using errcode = 'WF401';
  end if;
  begin
    parsed := pg_catalog.to_date(raw, 'YYYY-MM-DD');
  exception when others then
    parsed := null;
  end;
  -- to_date rolls some impossible dates over (2026-02-30), so compare the round trip.
  if parsed is null or pg_catalog.to_char(parsed, 'YYYY-MM-DD') <> raw then
    raise exception 'Invalid schedule: % is not a real date', what using errcode = 'WF401';
  end if;
  return parsed;
end;
$$;

revoke all on function private.schedule_date(jsonb, text) from public;

-- An `HH:MM` 24-hour string (LocalTime in @whosfree/shared).
create function private.schedule_time(value jsonb, what text) returns time
language plpgsql
immutable
set search_path = ''
as $$
begin
  if value is null or pg_catalog.jsonb_typeof(value) <> 'string'
    or (value #>> '{}') !~ '^([01]\d|2[0-3]):[0-5]\d$' then
    raise exception 'Invalid schedule: % must be an HH:MM time', what using errcode = 'WF401';
  end if;
  return (value #>> '{}')::time;
end;
$$;

revoke all on function private.schedule_time(jsonb, text) from public;

-- ---------------------------------------------------------------------------
-- private.clean_schedule_period(period): the period (SchedulePeriod plus the
-- ScheduleCommit limits) as {"start", "end", "exceptions"}, with labels
-- trimmed and empty ones dropped. Raises WF401 when it breaks a rule.
-- ---------------------------------------------------------------------------
create function private.clean_schedule_period(period jsonb) returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  -- SCHEDULE_PERIOD_MAX_DAYS, SCHEDULE_MAX_EXCEPTIONS and
  -- SCHEDULE_EXCEPTION_LABEL_MAX_LENGTH in @whosfree/shared.
  max_days constant integer := 366;
  max_exceptions constant integer := 50;
  max_label constant integer := 60;
  p_start date;
  p_end date;
  raw_exceptions jsonb;
  x jsonb;
  i integer;
  what text;
  x_start date;
  x_end date;
  label text;
  cleaned jsonb := '[]';
begin
  perform private.schedule_check_keys(period, array['start', 'end', 'exceptions'], 'period');
  p_start := private.schedule_date(period -> 'start', 'period.start');
  p_end := private.schedule_date(period -> 'end', 'period.end');
  if p_end < p_start then
    raise exception 'Invalid schedule: period.end must be on or after period.start'
      using errcode = 'WF401';
  end if;
  if p_end - p_start + 1 > max_days then
    raise exception 'Invalid schedule: period can be at most % days', max_days
      using errcode = 'WF401';
  end if;

  raw_exceptions := coalesce(period -> 'exceptions', '[]'::jsonb);
  if pg_catalog.jsonb_typeof(raw_exceptions) <> 'array' then
    raise exception 'Invalid schedule: period.exceptions must be an array' using errcode = 'WF401';
  end if;
  if pg_catalog.jsonb_array_length(raw_exceptions) > max_exceptions then
    raise exception 'Invalid schedule: at most % exceptions', max_exceptions
      using errcode = 'WF401';
  end if;

  for x, i in
    select e.value, e.ordinality::integer - 1
    from pg_catalog.jsonb_array_elements(raw_exceptions) with ordinality as e
  loop
    what := pg_catalog.format('period.exceptions[%s]', i);
    perform private.schedule_check_keys(x, array['start', 'end', 'label'], what);
    x_start := private.schedule_date(x -> 'start', what || '.start');
    x_end := private.schedule_date(x -> 'end', what || '.end');
    if x_end < x_start then
      raise exception 'Invalid schedule: %.end must be on or after its start', what
        using errcode = 'WF401';
    end if;
    label := null;
    if x ? 'label' then
      if pg_catalog.jsonb_typeof(x -> 'label') <> 'string' then
        raise exception 'Invalid schedule: %.label must be a string', what using errcode = 'WF401';
      end if;
      label := pg_catalog.regexp_replace(x ->> 'label', '^\s+|\s+$', '', 'g');
      if pg_catalog.char_length(label) > max_label then
        raise exception 'Invalid schedule: %.label can be at most % characters', what, max_label
          using errcode = 'WF401';
      end if;
    end if;
    cleaned := cleaned || pg_catalog.jsonb_build_array(
      case
        when label is null or label = '' then
          pg_catalog.jsonb_build_object('start', x_start, 'end', x_end)
        else pg_catalog.jsonb_build_object('start', x_start, 'end', x_end, 'label', label)
      end
    );
  end loop;

  return pg_catalog.jsonb_build_object('start', p_start, 'end', p_end, 'exceptions', cleaned);
end;
$$;

revoke all on function private.clean_schedule_period(jsonb) from public;

-- ---------------------------------------------------------------------------
-- private.schedule_event_row(event, n, period_start, period_end, tz): checks
-- draft event number `n` (EventDraft in @whosfree/shared) and returns the
-- row to store: {"n", "title", "category", "starts_at", "ends_at", "rrule",
-- "exdates"}. Raises WF401 when it breaks a rule and WF402 when it never
-- happens inside the period. See the header for the encoding.
-- ---------------------------------------------------------------------------
create function private.schedule_event_row(
  event jsonb,
  n integer,
  period_start date,
  period_end date,
  tz text
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  -- EVENT_TITLE_MAX_LENGTH and EVENT_CATEGORIES in @whosfree/shared.
  max_title constant integer := 120;
  categories constant text[] := array['class', 'lab', 'tutorial', 'work', 'meeting', 'event', 'other'];
  day_names constant text[] := array['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  day_codes constant text[] := array['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
  what text := pg_catalog.format('events[%s]', n);
  title text;
  category text;
  start_time time;
  end_time time;
  -- 1 when the event runs past midnight.
  end_day integer;
  confidence jsonb;
  w jsonb;
  pattern jsonb;
  pattern_type text;
  parity integer;
  weeks integer[] := '{}';
  days integer[] := '{}';
  item jsonb;
  day_index integer;
  week integer;
  week_one date;
  d date;
  first_day date;
  last_day date;
  exdates timestamptz[] := '{}';
  rule text;
begin
  perform private.schedule_check_keys(
    event, array['title', 'category', 'start', 'end', 'when', 'confidence'], what
  );

  if pg_catalog.jsonb_typeof(event -> 'title') is distinct from 'string' then
    raise exception 'Invalid schedule: %.title must be a string', what using errcode = 'WF401';
  end if;
  title := pg_catalog.regexp_replace(event ->> 'title', '^\s+|\s+$', '', 'g');
  if pg_catalog.char_length(title) not between 1 and max_title then
    raise exception 'Invalid schedule: %.title must be 1 to % characters', what, max_title
      using errcode = 'WF401';
  end if;

  category := event ->> 'category';
  if pg_catalog.jsonb_typeof(event -> 'category') is distinct from 'string'
    or category <> all (categories) then
    raise exception 'Invalid schedule: %.category is not a known category', what
      using errcode = 'WF401';
  end if;

  start_time := private.schedule_time(event -> 'start', what || '.start');
  end_time := private.schedule_time(event -> 'end', what || '.end');
  if start_time = end_time then
    raise exception 'Invalid schedule: % must have a duration', what using errcode = 'WF401';
  end if;
  end_day := case when end_time < start_time then 1 else 0 end;

  -- Not stored (manual entries are always 1), but part of the draft's shape.
  confidence := event -> 'confidence';
  if pg_catalog.jsonb_typeof(confidence) is distinct from 'number'
    or (confidence #>> '{}')::numeric not between 0 and 1 then
    raise exception 'Invalid schedule: %.confidence must be a number from 0 to 1', what
      using errcode = 'WF401';
  end if;

  w := event -> 'when';
  if pg_catalog.jsonb_typeof(w) is distinct from 'object'
    or pg_catalog.jsonb_typeof(w -> 'kind') is distinct from 'string'
    or (w ->> 'kind') not in ('weekly', 'date') then
    raise exception 'Invalid schedule: %.when.kind must be weekly or date', what
      using errcode = 'WF401';
  end if;

  -- A dated event (FR-IMP-6): one row, on a day inside the period.
  if w ->> 'kind' = 'date' then
    perform private.schedule_check_keys(w, array['kind', 'date'], what || '.when');
    d := private.schedule_date(w -> 'date', what || '.when.date');
    if d < period_start or d > period_end then
      raise exception 'Invalid schedule: % is outside the schedule period', what
        using errcode = 'WF402', detail = pg_catalog.jsonb_build_object('event', n)::text;
    end if;
    return pg_catalog.jsonb_build_object(
      'n', n,
      'title', title,
      'category', category,
      'starts_at', private.local_to_utc(d + start_time, tz),
      'ends_at', private.local_to_utc(d + end_day + end_time, tz),
      'rrule', null,
      'exdates', '[]'::jsonb
    );
  end if;

  perform private.schedule_check_keys(w, array['kind', 'days', 'pattern'], what || '.when');
  if pg_catalog.jsonb_typeof(w -> 'days') is distinct from 'array'
    or pg_catalog.jsonb_array_length(w -> 'days') = 0 then
    raise exception 'Invalid schedule: %.when.days must list at least one day', what
      using errcode = 'WF401';
  end if;
  for item in select x.value from pg_catalog.jsonb_array_elements(w -> 'days') as x loop
    day_index := pg_catalog.array_position(day_names, item #>> '{}');
    if pg_catalog.jsonb_typeof(item) <> 'string' or day_index is null then
      raise exception 'Invalid schedule: %.when.days has an unknown day', what
        using errcode = 'WF401';
    end if;
    if day_index = any (days) then
      raise exception 'Invalid schedule: %.when.days must be unique', what using errcode = 'WF401';
    end if;
    -- ISO weekday numbers, Monday = 1 … Sunday = 7, as extract(isodow) gives them.
    days := days || day_index;
  end loop;

  pattern := w -> 'pattern';
  pattern_type := pattern ->> 'type';
  if pg_catalog.jsonb_typeof(pattern) is distinct from 'object'
    or pg_catalog.jsonb_typeof(pattern -> 'type') is distinct from 'string'
    or pattern_type not in ('every', 'alternating', 'weeks') then
    raise exception 'Invalid schedule: %.when.pattern.type must be every, alternating or weeks',
      what using errcode = 'WF401';
  end if;
  if pattern_type = 'every' then
    perform private.schedule_check_keys(pattern, array['type'], what || '.when.pattern');
  elsif pattern_type = 'alternating' then
    perform private.schedule_check_keys(pattern, array['type', 'parity'], what || '.when.pattern');
    if pg_catalog.jsonb_typeof(pattern -> 'parity') is distinct from 'string'
      or (pattern ->> 'parity') not in ('odd', 'even') then
      raise exception 'Invalid schedule: %.when.pattern.parity must be odd or even', what
        using errcode = 'WF401';
    end if;
    parity := case when pattern ->> 'parity' = 'odd' then 1 else 0 end;
  else
    perform private.schedule_check_keys(pattern, array['type', 'weeks'], what || '.when.pattern');
    if pg_catalog.jsonb_typeof(pattern -> 'weeks') is distinct from 'array'
      or pg_catalog.jsonb_array_length(pattern -> 'weeks') = 0 then
      raise exception 'Invalid schedule: %.when.pattern.weeks must list at least one week', what
        using errcode = 'WF401';
    end if;
    for item in select x.value from pg_catalog.jsonb_array_elements(pattern -> 'weeks') as x loop
      if pg_catalog.jsonb_typeof(item) <> 'number'
        or (item #>> '{}')::numeric <> pg_catalog.trunc((item #>> '{}')::numeric)
        or (item #>> '{}')::numeric not between 1 and 60 then
        raise exception 'Invalid schedule: %.when.pattern.weeks must be whole numbers from 1 to 60',
          what using errcode = 'WF401';
      end if;
      week := (item #>> '{}')::integer;
      if week = any (weeks) then
        raise exception 'Invalid schedule: %.when.pattern.weeks must be unique', what
          using errcode = 'WF401';
      end if;
      weeks := weeks || week;
    end loop;
  end if;

  -- The Monday of week 1: the week (Monday–Sunday) containing the period's start.
  week_one := period_start - (extract(isodow from period_start)::integer - 1);
  for i in 0 .. (period_end - period_start) loop
    d := period_start + i;
    if extract(isodow from d)::integer = any (days) then
      week := (d - (extract(isodow from d)::integer - 1) - week_one) / 7 + 1;
      if pattern_type = 'every'
        or (pattern_type = 'alternating' and week % 2 = parity)
        or (pattern_type = 'weeks' and week = any (weeks)) then
        first_day := coalesce(first_day, d);
        last_day := d;
      elsif pattern_type = 'weeks' and first_day is not null then
        -- An occurrence of the weekly rule in a week that wasn't chosen. Any after
        -- last_day are past UNTIL and dropped below.
        exdates := exdates || private.local_to_utc(d + start_time, tz);
      end if;
    end if;
  end loop;

  if first_day is null then
    raise exception 'Invalid schedule: % never happens in the schedule period', what
      using errcode = 'WF402', detail = pg_catalog.jsonb_build_object('event', n)::text;
  end if;
  exdates := array(
    select x from pg_catalog.unnest(exdates) as x
    where x < private.local_to_utc(last_day + start_time, tz)
    order by x
  );

  rule := 'FREQ=WEEKLY;'
    || case when pattern_type = 'alternating' then 'INTERVAL=2;' else '' end
    || 'WKST=MO;BYDAY='
    || (select pg_catalog.string_agg(day_codes[x], ',' order by x) from pg_catalog.unnest(days) as x)
    || ';UNTIL='
    || pg_catalog.to_char(
      private.local_to_utc(last_day + start_time, tz) at time zone 'UTC',
      'YYYYMMDD"T"HH24MISS"Z"'
    );

  return pg_catalog.jsonb_build_object(
    'n', n,
    'title', title,
    'category', category,
    'starts_at', private.local_to_utc(first_day + start_time, tz),
    'ends_at', private.local_to_utc(first_day + end_day + end_time, tz),
    'rrule', rule,
    'exdates', pg_catalog.to_jsonb(exdates)
  );
end;
$$;

revoke all on function private.schedule_event_row(jsonb, integer, date, date, text) from public;

-- ---------------------------------------------------------------------------
-- public.commit_schedule(draft, source_type, offline_friend_id): saves the
-- caller's confirmed schedule (or one of their offline friends', WF-127) and
-- returns the new source's id. One transaction: on any error nothing is
-- written and nothing is replaced.
--
--   draft             ScheduleCommit (see the header), as jsonb.
--   source_type       'manual' (WF-031) or 'upload' (a confirmed parse, WF-027).
--   offline_friend_id null for the caller's own schedule, else one of the
--                     caller's offline friends ("not found" otherwise).
-- ---------------------------------------------------------------------------
create function public.commit_schedule(
  draft jsonb,
  source_type text default 'manual',
  offline_friend_id uuid default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  -- SCHEDULE_MAX_EVENTS and SCHEDULE_COMMITS_PER_DAY in @whosfree/shared.
  max_events constant integer := 200;
  commits_per_day constant integer := 20;
  me uuid := private.require_user();
  tz text;
  clean_period jsonb;
  period_start date;
  period_end date;
  event jsonb;
  n integer;
  event_rows jsonb := '[]';
  new_source uuid;
begin
  if commit_schedule.source_type is null
    or commit_schedule.source_type not in ('manual', 'upload') then
    raise exception 'source_type must be manual or upload' using errcode = '22023';
  end if;

  if commit_schedule.offline_friend_id is not null and not exists (
    select 1
    from public.offline_friends o
    where o.id = commit_schedule.offline_friend_id
      and o.user_id = me
  ) then
    raise exception 'Offline friend not found' using errcode = 'P0002';
  end if;

  perform private.schedule_check_keys(commit_schedule.draft, array['events', 'period'], 'draft');
  clean_period := private.clean_schedule_period(commit_schedule.draft -> 'period');
  period_start := (clean_period ->> 'start')::date;
  period_end := (clean_period ->> 'end')::date;
  if pg_catalog.jsonb_typeof(commit_schedule.draft -> 'events') is distinct from 'array'
    or pg_catalog.jsonb_array_length(commit_schedule.draft -> 'events') not between 1 and max_events
  then
    raise exception 'Invalid schedule: events must list 1 to % events', max_events
      using errcode = 'WF401';
  end if;

  -- Serialises this user's commits (two at once would otherwise each keep
  -- their own new source) and reads the timezone the times are in. An
  -- offline friend's schedule uses their owner's timezone (D44).
  select u.timezone into tz from public.users u where u.id = me for update;

  for event, n in
    select e.value, e.ordinality::integer - 1
    from pg_catalog.jsonb_array_elements(commit_schedule.draft -> 'events') with ordinality as e
  loop
    event_rows := event_rows || pg_catalog.jsonb_build_array(
      private.schedule_event_row(event, n, period_start, period_end, tz)
    );
  end loop;

  -- NFR-SEC-9: confirmed uploads and manual saves together, own and offline
  -- friends' schedules alike. Counted only when the commit goes through.
  perform private.consume_rate_limit(me, 'commit_schedule', commits_per_day, interval '1 day');

  -- Replace the target's previous confirmed schedule (see the header). Its
  -- events go with it (on delete cascade). Google Calendar sources stay.
  -- TODO(WF-033): instead end the old recurring events on a date the user
  -- picks and keep past history (FR-IMP-17).
  delete from public.sources s
  where s.user_id = me
    and s.type in ('upload', 'manual')
    and s.offline_friend_id is not distinct from commit_schedule.offline_friend_id;

  insert into public.sources (
    user_id, offline_friend_id, type, period_start, period_end, period_exceptions
  )
  values (
    me,
    commit_schedule.offline_friend_id,
    commit_schedule.source_type,
    period_start,
    period_end,
    clean_period -> 'exceptions'
  )
  returning sources.id into new_source;

  -- One statement, so the Now signal triggers fire once for the whole schedule.
  insert into public.events (
    user_id, offline_friend_id, source_id, title, category, starts_at, ends_at, rrule, exdates
  )
  select
    me,
    commit_schedule.offline_friend_id,
    new_source,
    r.title,
    r.category,
    r.starts_at,
    r.ends_at,
    r.rrule,
    r.exdates
  from pg_catalog.jsonb_to_recordset(event_rows) as r (
    n integer,
    title text,
    category text,
    starts_at timestamptz,
    ends_at timestamptz,
    rrule text,
    exdates timestamptz[]
  )
  order by r.n;

  -- Parse pipeline hook (WF-027/WF-030, D38), for source_type = 'upload'.
  -- When parse_jobs and schedule_files exist, this function takes the job
  -- id, checks the job is the caller's and in `needs_review`, and here, in
  -- this same transaction:
  --   1. the job moves to `committed`;
  --   2. the draft and the file's row are deleted (FR-IMP-15);
  -- then returns the file's storage path so the server removes the Storage
  -- object straight after the commit. The expiry cron retries any removal
  -- that fails (FR-ADM-4).

  return new_source;
end;
$$;

comment on function public.commit_schedule(jsonb, text, uuid) is
  'WF-030: saves a confirmed schedule (ScheduleCommit jsonb) for the caller or one of their offline friends as a source with its period and RRULE events, replacing the previous upload/manual schedule. Returns the source id.';

revoke all on function public.commit_schedule(jsonb, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.commit_schedule(jsonb, text, uuid) to authenticated;
