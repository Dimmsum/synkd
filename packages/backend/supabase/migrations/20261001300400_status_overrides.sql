-- WF-063: manual status override (PRD §9 `statusOverrides`, FR-AVL-3, J5, D5).
--
-- A user sets a status (Free, Busy, Do not disturb, Away, Studying/Focused)
-- that overrides their calendar until an end time or "until I change it"
-- (ends_at null). The availability engine applies overrides in
-- [starts_at, ends_at); when several are active the latest-starting one wins.
--
-- Clients can only read their own rows. Writes go through `set_status()` and
-- `clear_status()`, which always start at now(), so a user can't backdate a
-- status or schedule one far ahead, and which close the previous status:
-- without that, an old "until I change it" status would come back when a
-- newer timed one ends. Other users' overrides are not selectable; the Now
-- function (WF-064) will read them inside its security definer function and
-- decide which tiers may see the label.

create table public.status_overrides (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  -- MANUAL_STATUSES in @whosfree/shared. `focused` is shown to viewers as busy.
  status text not null check (status in ('free', 'busy', 'dnd', 'away', 'focused')),
  -- Optional short plain-text label, e.g. "Revising for MATH1141". Trimmed,
  -- 1-40 characters, no control characters. The UI should not suggest
  -- putting a location here (D35).
  label text check (
    label is null
    or (
      char_length(label) between 1 and 40
      and label = btrim(label)
      and label !~ '[[:cntrl:]]'
    )
  ),
  starts_at timestamptz not null default now(),
  -- Null = "until I change it".
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  constraint status_overrides_ends_after_start check (ends_at is null or ends_at > starts_at)
);

create index status_overrides_user_id_starts_at_idx
  on public.status_overrides (user_id, starts_at);

-- At most one open-ended ("until I change it") status per user. set_status()
-- closes the previous one before inserting, so this never fires in normal use;
-- it guards against a write path that forgets to.
create unique index status_overrides_one_open_key
  on public.status_overrides (user_id)
  where ends_at is null;

comment on table public.status_overrides is
  'Manual statuses (PRD §9 statusOverrides, FR-AVL-3). Owner-readable only; written by set_status() and clear_status().';

-- ---------------------------------------------------------------------------
-- private.close_active_status(user): ends the user's current status now.
-- Rows that started at this same instant (an earlier set_status in the same
-- transaction) are deleted instead, since they would have no duration.
-- Callers must hold the user's row lock (see set_status).
-- ---------------------------------------------------------------------------
create function private.close_active_status(owner uuid) returns void
language plpgsql
set search_path = ''
as $$
begin
  delete from public.status_overrides o
  where o.user_id = close_active_status.owner
    and o.starts_at >= pg_catalog.now();

  update public.status_overrides o
  set ends_at = pg_catalog.now()
  where o.user_id = close_active_status.owner
    and o.starts_at < pg_catalog.now()
    and (o.ends_at is null or o.ends_at > pg_catalog.now());
end;
$$;

revoke all on function private.close_active_status(uuid) from public;

-- ---------------------------------------------------------------------------
-- public.set_status(status, label, ends_at): sets the caller's manual status
-- from now until ends_at (null = "until I change it"), closing whatever status
-- was active. Returns the new row.
--
--   * status: one of free, busy, dnd, away, focused.
--   * label: optional; trimmed; empty = none; at most 40 characters; no
--     control characters.
--   * ends_at: null, or in the future and at most 7 days away (the engine's
--     "until X" look-ahead; anything longer is "until I change it").
--
-- security definer because clients can't write status_overrides directly.
-- ---------------------------------------------------------------------------
create function public.set_status(
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

  -- TODO(NFR-SEC-9): rate-limit with the shared helper (agent A) once it lands.
  -- Each call writes a row and will send a Realtime signal to every viewer (WF-064).

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
  'WF-063: sets the caller''s manual status from now until ends_at (null = until I change it), closing the previous one.';

revoke all on function public.set_status(text, text, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.set_status(text, text, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- public.clear_status(): ends the caller's current manual status now, so the
-- calendar-based status applies again. A no-op when none is active.
-- ---------------------------------------------------------------------------
create function public.clear_status() returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := public.current_user_id();
begin
  if me is null then
    raise exception 'User profile not found: call ensure_current_user first'
      using errcode = 'P0002';
  end if;

  perform 1 from public.users u where u.id = me for update;
  perform private.close_active_status(me);
end;
$$;

comment on function public.clear_status() is
  'WF-063: ends the caller''s current manual status now.';

revoke all on function public.clear_status() from public, anon, authenticated, service_role;
grant execute on function public.clear_status() to authenticated;

-- ---------------------------------------------------------------------------
-- private.purge_expired_status_overrides(retention): deletes overrides that
-- ended more than `retention` ago (default 7 days) and returns how many. For
-- the cleanup cron (WF-037), which runs as postgres; clients can't call it.
-- Ended overrides no longer affect any status now or later.
-- ---------------------------------------------------------------------------
create function private.purge_expired_status_overrides(retention interval default interval '7 days')
returns integer
language plpgsql
set search_path = ''
as $$
declare
  deleted integer;
begin
  if retention is null or retention < interval '0' then
    raise exception 'retention must be a non-negative interval' using errcode = '22023';
  end if;

  delete from public.status_overrides o
  where o.ends_at is not null
    and o.ends_at < pg_catalog.now() - retention;
  get diagnostics deleted = row_count;
  return deleted;
end;
$$;

revoke all on function private.purge_expired_status_overrides(interval) from public;

-- ---------------------------------------------------------------------------
-- Privileges and RLS: the owner reads their own overrides; nobody writes
-- directly.
-- ---------------------------------------------------------------------------
alter table public.status_overrides enable row level security;

revoke all on table public.status_overrides from anon, authenticated;
grant select on table public.status_overrides to authenticated;

create policy status_overrides_select_own on public.status_overrides
  for select to authenticated
  using (user_id = (select public.current_user_id()));
