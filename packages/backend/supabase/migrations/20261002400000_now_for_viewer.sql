-- WF-064: the Now screen's data (PRD §8.5 "Now screen", FR-VIEW-1, FR-VIEW-2,
-- FR-VIS-3, FR-VIS-4, FR-VIS-5, FR-VIS-6, FR-AVL-2, FR-AVL-3, D18, D22, D35,
-- D41, D44).
--
-- public.now_for_viewer(range_start, range_end) returns one row per
-- connection of the signed-in viewer, with everything the availability engine
-- (@whosfree/availability `AvailabilityInput`) needs to work out their status
-- and "until X", already redacted to the viewer's tier. It returns data, not a
-- status: the Next.js server runs `statusAt(now)` over it (PRD §8.5).
--
-- Redaction reuses the existing single paths: private.resolve_tier (the tier),
-- private.redacted_events (the events) and private.visible_profile (the
-- profile). Overrides and schedule sources get their own private helpers
-- below, so the friend detail view (WF-065) and the "how others see me"
-- preview (WF-049) can reuse them.
--
-- Offline friends (D44, FR-SOC-15, WF-127): sources and events with
-- offline_friend_id set hold the schedule of someone who isn't on whosfree,
-- added by the user. They are never the user's own schedule and never reach
-- another viewer: private.redacted_events already skips their events
-- (20261002300100_offline_friends_isolation.sql), and every direct read of
-- sources below adds `offline_friend_id is null`.
--
-- Realtime "changed" signals for this screen are in the next migration.

-- ---------------------------------------------------------------------------
-- private.connections(me): everyone whose schedule `me` can see on the Now
-- screen, once each: accepted friends plus co-members of `me`'s groups,
-- leaving out `me` and anyone blocked in either direction (FR-SOC-6, D43).
-- Pending requests and friends of friends are not connections.
--
-- Symmetric: b is in connections(a) exactly when a is in connections(b), so
-- the same set is "whose data a viewer sees" and "which viewers a change to
-- someone's data affects" (the Realtime triggers use it that way).
--
-- Offline friends (D44) are never connections: they aren't users, and only
-- rows of public.users are returned here.
-- ---------------------------------------------------------------------------
create function private.connections(me uuid)
returns table (user_id uuid)
language sql
stable
set search_path = ''
as $$
  select c.other
  from (
    select case when f.user_a = connections.me then f.user_b else f.user_a end as other
    from public.friendships f
    where connections.me in (f.user_a, f.user_b)
      and f.status = 'accepted'
    union
    select theirs.user_id
    from public.group_members mine
    join public.group_members theirs on theirs.group_id = mine.group_id
    where mine.user_id = connections.me
      and theirs.user_id <> connections.me
  ) c
  where connections.me is not null
    and not private.is_blocked(connections.me, c.other)
$$;

revoke all on function private.connections(uuid) from public;

-- ---------------------------------------------------------------------------
-- private.epoch_ms(ts): UTC epoch milliseconds (null stays null), the unit of
-- every instant in @whosfree/availability.
-- ---------------------------------------------------------------------------
create function private.epoch_ms(ts timestamptz) returns bigint
language sql
stable
set search_path = ''
as $$
  select pg_catalog.floor(extract(epoch from ts) * 1000)::bigint
$$;

revoke all on function private.epoch_ms(timestamptz) from public;

-- ---------------------------------------------------------------------------
-- private.visible_overrides(owner, tier, range_start, range_end): the owner's
-- manual statuses (WF-063) overlapping [range_start, range_end), as a viewer
-- at `tier` may see them, as a jsonb array of the engine's `StatusOverride`
-- plus a label, ordered by start:
--
--   [{"id": uuid, "status": "busy", "label": null,
--     "startsAt": <epoch ms>, "endsAt": <epoch ms> | null}]
--
--   * `label` (free text the owner typed) only at T3, like event titles;
--   * `focused` ("Studying/Focused") is a reason, like an event's category,
--     so below T2 it is returned as plain `busy`, which is how it's displayed
--     anyway (MANUAL_STATUS_TO_STATUS).
--
-- A null or out-of-range tier returns [].
-- ---------------------------------------------------------------------------
create function private.visible_overrides(
  owner uuid,
  tier smallint,
  range_start timestamptz,
  range_end timestamptz
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', o.id,
        'status', case
          when visible_overrides.tier < 2 and o.status = 'focused' then 'busy'
          else o.status
        end,
        'label', case when visible_overrides.tier >= 3 then o.label end,
        'startsAt', private.epoch_ms(o.starts_at),
        'endsAt', private.epoch_ms(o.ends_at)
      )
      order by o.starts_at, o.id
    ),
    '[]'::jsonb
  )
  from public.status_overrides o
  where visible_overrides.tier between 1 and 3
    and o.user_id = visible_overrides.owner
    and o.starts_at < visible_overrides.range_end
    and (o.ends_at is null or o.ends_at > visible_overrides.range_start)
$$;

revoke all on function private.visible_overrides(uuid, smallint, timestamptz, timestamptz)
  from public;

-- ---------------------------------------------------------------------------
-- private.visible_sources(owner, tier, range_start, range_end): the owner's
-- schedule sources with their events in the range, as a viewer at `tier` may
-- see them, as a jsonb array in the shape of the engine's `ScheduleSource[]`:
--
--   [{"period": {"start": "2026-09-01", "end": "2026-12-18",
--                "exceptions": [{"start": "...", "end": "..."}]} | null,
--     "events": [{"id": uuid, "start": <epoch ms>, "end": <epoch ms>,
--                 "rrule": text | null, "exdates": [<epoch ms>],
--                 "category": text | null, "title": text | null}]}]
--
--   * Every source of the owner's own is listed, even one with no events in
--     the range: the engine counts any source as "has a schedule" (D22).
--     Offline friends' sources are never listed (D44).
--   * Events come only from private.redacted_events, the single redaction
--     path (busy events only; category from T2, title from T3, neither for
--     private events; no location exists, D35). events is joined back on id
--     only to group them by source; nothing else is read from it.
--   * The period is needed to expand recurring events correctly (breaks,
--     FR-IMP-7, FR-IMP-8). Its dates only shape busy times, which every tier
--     sees; the exceptions' free-text labels are dropped at every tier.
--     period_exceptions is written by the owner under RLS with no shape
--     check, so only entries with YYYY-MM-DD start and end are passed on:
--     one malformed entry must not break the engine for every viewer.
--     (Dropping one can only make the owner look busier, never freer.)
--   * No source ids, types or sync state are returned.
--
-- A null or out-of-range tier returns [].
-- ---------------------------------------------------------------------------
create function private.visible_sources(
  owner uuid,
  tier smallint,
  range_start timestamptz,
  range_end timestamptz
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with visible_events as (
    select e.source_id, r.id, r.starts_at, r.ends_at, r.rrule, r.exdates, r.category, r.title
    from private.redacted_events(
      visible_sources.owner,
      visible_sources.tier,
      visible_sources.range_start,
      visible_sources.range_end
    ) r
    join public.events e on e.id = r.id
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'period', case
          when s.period_start is not null then jsonb_build_object(
            'start', s.period_start,
            'end', s.period_end,
            'exceptions', (
              select coalesce(
                jsonb_agg(
                  jsonb_build_object('start', x.value -> 'start', 'end', x.value -> 'end')
                  order by x.n
                ),
                '[]'::jsonb
              )
              from jsonb_array_elements(s.period_exceptions) with ordinality as x (value, n)
              where jsonb_typeof(x.value) = 'object'
                and x.value ->> 'start' ~ '^\d{4}-\d{2}-\d{2}$'
                and x.value ->> 'end' ~ '^\d{4}-\d{2}-\d{2}$'
            )
          )
        end,
        'events', (
          select coalesce(
            jsonb_agg(
              jsonb_build_object(
                'id', ev.id,
                'start', private.epoch_ms(ev.starts_at),
                'end', private.epoch_ms(ev.ends_at),
                'rrule', ev.rrule,
                'exdates', (
                  select coalesce(jsonb_agg(private.epoch_ms(d) order by d), '[]'::jsonb)
                  from unnest(ev.exdates) d
                ),
                'category', ev.category,
                'title', ev.title
              )
              order by ev.starts_at, ev.id
            ),
            '[]'::jsonb
          )
          from visible_events ev
          where ev.source_id = s.id
        )
      )
      order by s.created_at, s.id
    ),
    '[]'::jsonb
  )
  from public.sources s
  where visible_sources.tier between 1 and 3
    and s.user_id = visible_sources.owner
    and s.offline_friend_id is null
$$;

revoke all on function private.visible_sources(uuid, smallint, timestamptz, timestamptz)
  from public;

-- ---------------------------------------------------------------------------
-- public.now_for_viewer(range_start, range_end): the signed-in viewer's
-- connections for the Now screen, one row each, ordered by name.
--
-- The viewer is always the caller (current_user_id()); there is no viewer
-- argument. No rows when the caller has no users row.
--
-- The range is the window the engine will look at: range_start defaults to
-- now() and range_end to range_start + 7 days (the engine's default "until X"
-- look-ahead, DEFAULT_UNTIL_HORIZON_MS), and it may be at most 8 days. Call
-- it with the same `now` you pass to statusAt(), so "free soon" (within 60
-- minutes) and every "until X" are exact.
--
-- Columns:
--   user_id, name, handle, avatar_url, relationship
--                    the public profile, from private.visible_profile
--                    (relationship: 'friend', or 'none' for a group
--                    co-member who isn't a friend, or a pending request).
--   tier             the viewer's resolved tier (1-3) of this person.
--   paused           they paused sharing (FR-VIS-6): show "Sharing paused".
--                    Then every schedule field below is empty: has_schedule
--                    false, timezone and available_hours null, overrides and
--                    sources [].
--   has_schedule     they have at least one schedule source of their own
--                    (false = "Not sharing yet", no_schedule, D22); an
--                    offline friend's schedule doesn't count (D44).
--   group_ids        the groups both people are in, for the group filter
--                    (FR-VIEW-2); empty for a friend with no shared group.
--   timezone         their IANA timezone (AvailabilityInput.timeZone).
--   available_hours  AvailableHours[] (AvailabilityInput.availableHours).
--   overrides        see private.visible_overrides (label only at T3).
--   sources          see private.visible_sources (redacted events).
--
-- Mapping to the engine: { timeZone: timezone, sharingPaused: paused,
-- availableHours: available_hours, overrides, sources }.
-- ---------------------------------------------------------------------------
create function public.now_for_viewer(
  range_start timestamptz default now(),
  range_end timestamptz default null
)
returns table (
  user_id uuid,
  name text,
  handle text,
  avatar_url text,
  relationship text,
  tier smallint,
  paused boolean,
  has_schedule boolean,
  group_ids uuid[],
  timezone text,
  available_hours jsonb,
  overrides jsonb,
  sources jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  viewer uuid;
  window_start timestamptz := now_for_viewer.range_start;
  window_end timestamptz :=
    coalesce(now_for_viewer.range_end, now_for_viewer.range_start + interval '7 days');
begin
  if window_start is null or window_end is null or window_end <= window_start then
    raise exception 'range_end must be after range_start' using errcode = '22023';
  end if;
  if window_end - window_start > interval '8 days' then
    raise exception 'The range can be at most 8 days' using errcode = '22023';
  end if;

  viewer := public.current_user_id();
  if viewer is null then
    return;
  end if;

  return query
    select
      p.id,
      p.name,
      p.handle,
      p.avatar_url,
      p.relationship,
      c.tier,
      u.sharing_paused,
      not u.sharing_paused and exists (
        select 1 from public.sources s where s.user_id = u.id and s.offline_friend_id is null
      ),
      array(
        select mine.group_id
        from public.group_members mine
        join public.group_members theirs
          on theirs.group_id = mine.group_id
         and theirs.user_id = u.id
        where mine.user_id = viewer
        order by mine.group_id
      ),
      case when not u.sharing_paused then u.timezone end,
      case when not u.sharing_paused then ap.weekly end,
      case
        when u.sharing_paused then '[]'::jsonb
        else private.visible_overrides(u.id, c.tier, window_start, window_end)
      end,
      case
        when u.sharing_paused then '[]'::jsonb
        else private.visible_sources(u.id, c.tier, window_start, window_end)
      end
    from (
      select cn.user_id as id, private.resolve_tier(viewer, cn.user_id) as tier
      from private.connections(viewer) cn
    ) c
    join public.users u on u.id = c.id
    cross join lateral private.visible_profile(viewer, c.id) p
    left join public.availability_prefs ap on ap.user_id = c.id
    where c.tier is not null
    order by p.name, p.id;
end;
$$;

comment on function public.now_for_viewer(timestamptz, timestamptz) is
  'WF-064: the caller''s connections (friends and group co-members, no blocks) with profile, resolved tier, paused and has-schedule flags, shared group ids, and tier-redacted engine input (timezone, available hours, overrides, sources with events) for the range.';

revoke all on function public.now_for_viewer(timestamptz, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.now_for_viewer(timestamptz, timestamptz) to authenticated;
