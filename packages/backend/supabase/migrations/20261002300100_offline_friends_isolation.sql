-- WF-127: offline friends' schedules stay out of everyone else's view and
-- out of the owner's own availability (FR-SOC-15, D44, PRD §9 `events`).
--
-- Events and sources with offline_friend_id set belong to an offline friend
-- of user_id, not to user_id. The only read path of another user's schedule
-- so far is private.redacted_events (used by events_for_viewer), so it now
-- skips them: viewers never receive them, at any tier, and they never make
-- the owner look busy. Every later function that reads `events` or `sources`
-- for a user's own schedule or status (now_for_viewer WF-064, the "how others
-- see me" preview WF-049, a "has a schedule" check for `no_schedule`) must
-- filter `offline_friend_id is null` the same way; test/offline-friends.test.ts
-- checks the ones that exist.
--
-- Same definition as in 20260930201538_visibility_tiers_and_redaction.sql,
-- plus the two `offline_friend_id is null` conditions.

create or replace function private.redacted_events(
  owner uuid,
  tier smallint,
  range_start timestamptz,
  range_end timestamptz
)
returns table (
  id uuid,
  starts_at timestamptz,
  ends_at timestamptz,
  rrule text,
  exdates timestamptz[],
  category text,
  title text
)
language sql
stable
set search_path = ''
as $$
  select
    e.id,
    e.starts_at,
    e.ends_at,
    e.rrule,
    e.exdates,
    case when redacted_events.tier >= 2 and not e.is_private then e.category end,
    case when redacted_events.tier >= 3 and not e.is_private then e.title end
  from public.events e
  join public.sources s on s.id = e.source_id
  where redacted_events.tier between 1 and 3
    and e.user_id = redacted_events.owner
    -- D44: the owner's offline friends' events are not the owner's schedule.
    -- The source check is redundant (the events trigger keeps both equal) but
    -- keeps this path safe on its own.
    and e.offline_friend_id is null
    and s.offline_friend_id is null
    and e.busy
    and e.starts_at < redacted_events.range_end
    and (
      (e.rrule is null and e.ends_at > redacted_events.range_start)
      or (
        e.rrule is not null
        and (
          s.period_end is null
          or ((s.period_end + 2)::timestamp at time zone 'UTC') + (e.ends_at - e.starts_at)
            > redacted_events.range_start
        )
      )
    )
  order by e.starts_at, e.id
$$;

revoke all on function private.redacted_events(uuid, smallint, timestamptz, timestamptz) from public;
