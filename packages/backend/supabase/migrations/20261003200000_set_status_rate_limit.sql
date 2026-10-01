-- WF-063: rate-limit manual status changes (FR-AVL-3, NFR-SEC-9).
--
-- set_status() writes a row and, through the WF-064 triggers, sends a Realtime
-- "changed" signal to every connection of the caller. Without a limit one
-- account could flood its friends' and groups' clients with re-fetches. The
-- limit is STATUS_CHANGES_PER_HOUR in @whosfree/shared (60 an hour), action
-- 'status_change'. Failed calls (bad status, label or end time) roll back and
-- don't count.
--
-- clear_status() stays unlimited: going back to automatic must always work
-- (e.g. ending "Do not disturb"), and it only ends a status that set_status
-- (limited) created, so it can't be used to flood on its own.
--
-- The function body is the one from 20261001300400_status_overrides.sql with
-- the rate limit added where its TODO was; nothing else changes.

create or replace function public.set_status(
  status text,
  label text default null,
  ends_at timestamptz default null
)
returns public.status_overrides
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := public.current_user_id();
  clean_label text;
  result public.status_overrides;
begin
  if me is null then
    raise exception 'User profile not found: call ensure_current_user first'
      using errcode = 'P0002';
  end if;

  if set_status.status is null
    or not (set_status.status = any (array['free', 'busy', 'dnd', 'away', 'focused']))
  then
    raise exception 'Unknown status: %', coalesce(set_status.status, 'NULL')
      using errcode = '22023';
  end if;

  clean_label := nullif(pg_catalog.regexp_replace(set_status.label, '^\s+|\s+$', '', 'g'), '');
  if clean_label is not null and pg_catalog.char_length(clean_label) > 40 then
    raise exception 'Label must be at most 40 characters' using errcode = '22023';
  end if;
  if clean_label ~ '[[:cntrl:]]' then
    raise exception 'Label must not contain control characters' using errcode = '22023';
  end if;

  if set_status.ends_at is not null then
    if set_status.ends_at <= pg_catalog.now() then
      raise exception 'ends_at must be in the future' using errcode = '22023';
    end if;
    if set_status.ends_at > pg_catalog.now() + interval '7 days' then
      raise exception 'ends_at must be at most 7 days away (or null for "until I change it")'
        using errcode = '22023';
    end if;
  end if;

  -- NFR-SEC-9: STATUS_CHANGES_PER_HOUR (@whosfree/shared). Raises PT429
  -- (HTTP 429) with the retry time in the detail.
  perform private.consume_rate_limit(me, 'status_change', 60, interval '1 hour');

  -- Serialise this user's status changes, so two concurrent calls can't both
  -- see "nothing active" and leave two open-ended statuses.
  perform 1 from public.users u where u.id = me for update;

  perform private.close_active_status(me);

  insert into public.status_overrides (user_id, status, label, starts_at, ends_at)
  values (me, set_status.status, clean_label, pg_catalog.now(), set_status.ends_at)
  returning * into result;

  return result;
end;
$$;

comment on function public.set_status(text, text, timestamptz) is
  'WF-063: sets the caller''s manual status from now until ends_at (null = until I change it), closing the previous one. Rate-limited (60/hour, PT429).';

-- create or replace keeps the existing privileges; restated so this file says
-- who may call it.
revoke all on function public.set_status(text, text, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.set_status(text, text, timestamptz) to authenticated;
