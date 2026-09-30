-- NFR-SEC-9: rate limits for abusable writes (PRD §9 `rateLimits`, §8.2
-- "Rate limiting: a Postgres counter table checked inside the write
-- functions").
--
-- Fixed-window counters, one row per (user, action, window). Write functions
-- call `private.consume_rate_limit(user, action, max_count, window)` inside
-- their own transaction, before doing the write. Because the counter lives in
-- the caller's transaction, an attempt that fails later (and rolls back) does
-- not use up the allowance: the limit counts writes that actually happened.
--
-- Reuse (groups/invites WF-043/045, parses WF-035, pings WF-094): pick an
-- action name and call the helper from your security definer function, e.g.
--   perform private.consume_rate_limit(me, 'ping', 30, interval '1 day');
--   perform private.consume_rate_limit(me, 'ping_to:' || target, 3, interval '1 hour');
-- An action is a lowercase name, optionally followed by `:` and a scope such
-- as a target id, for per-target limits.
--
-- Windows are aligned to multiples of their length since 2000-01-01 00:00 UTC
-- (so daily windows start at 00:00 UTC, 19:00 in Jamaica). A fixed window can
-- let up to 2 x max_count through around a window boundary; that is accepted
-- for the MVP (PRD §8.2 chose fixed windows).

-- ---------------------------------------------------------------------------
-- rate_limits
-- ---------------------------------------------------------------------------
create table public.rate_limits (
  user_id uuid not null references public.users (id) on delete cascade,
  action text not null check (
    char_length(action) <= 100 and action ~ '^[a-z][a-z0-9_]*(:[A-Za-z0-9_-]+)?$'
  ),
  window_start timestamptz not null,
  -- Not in the PRD's column list: stored so cleanup knows when a row is dead
  -- (windows differ per action) and so errors can say when to retry.
  window_end timestamptz not null,
  count integer not null default 0 check (count >= 0),
  created_at timestamptz not null default now(),
  constraint rate_limits_pkey primary key (user_id, action, window_start),
  constraint rate_limits_window_ordered check (window_end > window_start)
);
create index rate_limits_window_end_idx on public.rate_limits (window_end);

comment on table public.rate_limits is
  'Fixed-window counters for abusable writes (NFR-SEC-9). Written only by private.consume_rate_limit; clients cannot read or write it.';

-- Clients get nothing: not their own counters either (a user doesn't need to
-- read them, and errors say when to retry). RLS is on with no policies, so
-- even a stray grant would expose no rows. service_role keeps Supabase's
-- default access (server-side only, bypasses RLS) like every other table.
alter table public.rate_limits enable row level security;
revoke all on table public.rate_limits from anon, authenticated;

-- ---------------------------------------------------------------------------
-- private.try_consume_rate_limit(user_id, action, max_count, window): uses one
-- unit of `user_id`'s allowance for `action` in the current window. Returns
-- true if the attempt is within `max_count` per `window`, false (and records
-- nothing) if the limit is already reached.
--
-- Concurrency-safe: see the upsert below.
--
-- Runs with the privileges of the security definer function that calls it.
-- ---------------------------------------------------------------------------
create function private.try_consume_rate_limit(
  p_user_id uuid,
  p_action text,
  p_max_count integer,
  p_window interval
) returns boolean
language plpgsql
volatile
set search_path = ''
as $$
declare
  w_start timestamptz;
  new_count integer;
begin
  if p_user_id is null or p_action is null then
    raise exception 'rate limit needs a user and an action' using errcode = '22004';
  end if;
  if p_max_count is null or p_max_count < 1 then
    raise exception 'rate limit max_count must be at least 1' using errcode = '22023';
  end if;
  if p_window is null or p_window <= interval '0' or p_window > interval '366 days' then
    raise exception 'rate limit window must be between 0 and 366 days' using errcode = '22023';
  end if;

  w_start := pg_catalog.date_bin(p_window, pg_catalog.now(), timestamptz '2000-01-01 00:00:00+00');

  -- The conditional upsert only increments while under the limit. ON CONFLICT
  -- locks the existing row and evaluates the WHERE on its latest version, so
  -- concurrent callers are serialised and can't both take the last unit.
  insert into public.rate_limits as r (user_id, action, window_start, window_end, count)
  values (p_user_id, p_action, w_start, w_start + p_window, 1)
  on conflict (user_id, action, window_start)
    do update set count = r.count + 1
    where r.count < p_max_count
  returning r.count into new_count;

  return new_count is not null;
end;
$$;

revoke all on function private.try_consume_rate_limit(uuid, text, integer, interval) from public;

comment on function private.try_consume_rate_limit(uuid, text, integer, interval) is
  'NFR-SEC-9: uses one unit of a fixed-window allowance; false (and nothing recorded) when the limit is reached.';

-- ---------------------------------------------------------------------------
-- private.consume_rate_limit(user_id, action, max_count, window): as above,
-- but raises when the limit is reached, which aborts the calling write.
--
-- Error: SQLSTATE PT429, message 'Too many attempts'. PostgREST turns a `PTxyz`
-- SQLSTATE into HTTP status xyz, so clients get HTTP 429 with code PT429
-- (map it to "Slow down"). The detail is JSON:
--   {"action": "<name without scope>", "limit": n, "retry_at": "<timestamptz>"}
-- The action's scope (e.g. a target user id) is left out of the detail.
-- ---------------------------------------------------------------------------
create function private.consume_rate_limit(
  p_user_id uuid,
  p_action text,
  p_max_count integer,
  p_window interval
) returns void
language plpgsql
volatile
set search_path = ''
as $$
begin
  if not private.try_consume_rate_limit(p_user_id, p_action, p_max_count, p_window) then
    raise exception 'Too many attempts'
      using
        errcode = 'PT429',
        detail = pg_catalog.jsonb_build_object(
          'action', pg_catalog.split_part(p_action, ':', 1),
          'limit', p_max_count,
          'retry_at',
          pg_catalog.date_bin(p_window, pg_catalog.now(), timestamptz '2000-01-01 00:00:00+00')
            + p_window
        )::text,
        hint = 'Slow down and try again later.';
  end if;
end;
$$;

revoke all on function private.consume_rate_limit(uuid, text, integer, interval) from public;

comment on function private.consume_rate_limit(uuid, text, integer, interval) is
  'NFR-SEC-9: uses one unit of a fixed-window allowance, or raises SQLSTATE PT429 (HTTP 429) when the limit is reached.';

-- ---------------------------------------------------------------------------
-- private.purge_expired_rate_limits(): deletes counters whose window has
-- ended; returns how many rows it deleted. To be scheduled by the retention
-- cron (WF-037); until then counters just accumulate harmlessly.
-- ---------------------------------------------------------------------------
create function private.purge_expired_rate_limits() returns integer
language sql
volatile
set search_path = ''
as $$
  with deleted as (
    delete from public.rate_limits r
    where r.window_end <= pg_catalog.now()
    returning 1
  )
  select count(*)::integer from deleted
$$;

revoke all on function private.purge_expired_rate_limits() from public;

comment on function private.purge_expired_rate_limits() is
  'Deletes rate-limit counters whose window has ended (for the WF-037 cron). Returns the number deleted.';
