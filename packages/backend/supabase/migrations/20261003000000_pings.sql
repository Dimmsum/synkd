-- WF-092: pings, the database half (PRD §9 `pings`; J3, FR-PING-1, FR-PING-2,
-- FR-PING-3, NFR-SEC-9, NFR-SEC-11, D14, D31, D32, D41, D43).
--
-- A ping is a one-tap "are you free?" nudge from one user to another: a
-- template ("Free for food?"), up to 140 characters of plain text, or both.
-- The recipient replies once (WF-093, reply_to_ping in the next migration).
--
--   send_ping(recipient, template, message, confirmed)
--                       authorises and stores a ping; returns who to notify
--   list_inbox()        the caller's received and sent pings, newest first
--   mark_pings_read(ping_ids)
--                       marks received pings (and replies to sent ones) read
--   unread_ping_count() the inbox badge
--
-- Authorisation (D41: Postgres decides, the Next.js server only delivers):
--   * The sender is always the caller (current_user_id()).
--   * The recipient must be a connection (FR-PING-1: an accepted friend or a
--     fellow group member) with no block in either direction
--     (private.connections). Strangers, pending requests and blocked people
--     all get WF201 "User not found", exactly like a missing user, so a
--     blocked sender can't tell they were blocked (FR-SOC-6, D43). Only the
--     blocker, pinging someone they blocked, gets WF206.
--   * The recipient's status right now (FR-PING-1): `dnd` or `paused` can't
--     be pinged (WF301); `busy`, `away` and `no_schedule` need `confirmed`
--     (WF302, the UI's "Ping anyway?" step); `free` goes straight through.
--     See private.ping_status for what is exact and what is approximate.
--   * Rate limit (NFR-SEC-9): 30 pings a day per sender ('ping').
--     TODO(WF-094, FR-PING-6): add 3 an hour per sender and recipient, e.g.
--       perform private.consume_rate_limit(me, 'ping_to:' || target, 3, interval '1 hour');
--     TODO(WF-094, FR-PING-7): mutes and quiet hours. A muted sender or a
--     ping during quiet hours still lands in the inbox; send_ping then
--     returns notify = false so the server skips the push. It is always true
--     until WF-094.
--   * Each pair is locked (private.lock_pair, like the friend and block
--     functions), so a ping can't slip past a block made at the same moment.
--
-- Delivery: send_ping returns (ping_id, recipient_id, sender_name, notify).
-- The Next.js server then sends Web Push to recipient_id only (WF-091,
-- apps/web/src/lib/push/send.ts). The inbox is the source of truth
-- (NFR-COMPAT-2), and a Realtime signal tells open inboxes to re-fetch.
--
-- Realtime: `inbox_changed` (INBOX_CHANGED_EVENT in @whosfree/shared) on the
-- same private `user:<users.id>` channel as `now_changed` (WF-064), with an
-- empty payload. The client re-fetches through list_inbox. The existing
-- realtime.messages policy already lets a user receive on their own channel
-- only, and no client can send.
--
-- Privacy:
--   * Ping text is plain text (D31): 1–140 characters, trimmed, no control
--     characters other than tab and newline. It is never logged (NFR-SEC-11):
--     no function here raises an error that repeats it.
--   * Nothing about location exists here (D35).
--   * Whether the recipient has read a ping (read_at) is not shown to the
--     sender: clients can't select read_at or reply_read_at directly, and
--     list_inbox returns each person only their own unread flag.
--
-- Hooks left for later issues:
--   * WF-095 (report): a `reports` row can reference pings.id.
--   * WF-096 (group ping): group_id (PRD §9) is stored for it; nothing sets it yet.
--   * WF-097 (expiry): expires_at is set to created_at + 2 hours (FR-PING-9);
--     enforcing it on replies is WF-097.
--   * FR-ADM-4 / D32 retention: private.purge_old_pings() deletes pings older
--     than 30 days, for the retention cron (WF-037).
--
-- Errors (DB_ERROR and PING_ERRORS in packages/backend/src): WF001 no
-- account; WF201 user not found (or not connected, or blocked either way);
-- WF202 yourself; WF206 you blocked them; WF301 recipient can't be pinged now
-- (detail: their status); WF302 confirmation needed (detail: their status);
-- PT429 rate limited; 22023 bad template or text.

-- ---------------------------------------------------------------------------
-- pings
-- ---------------------------------------------------------------------------
create table public.pings (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.users (id) on delete cascade,
  recipient_id uuid not null references public.users (id) on delete cascade,
  -- WF-096 group pings (FR-PING-5): the group a ping was sent to, one row per
  -- recipient. Not written yet.
  group_id uuid references public.groups (id) on delete set null,
  -- PING_TEMPLATES in @whosfree/shared (J3).
  template text check (
    template is null or template in ('Free for food?', 'Wanna study?', 'Link up?', 'Call me')
  ),
  -- D31: plain text, 1–140 characters, trimmed, no control characters except
  -- tab and newline. Never logged (NFR-SEC-11).
  text text check (
    text is null
    or (
      char_length(text) between 1 and 140
      and text !~ '^\s|\s$'
      and text !~ '[\u0001-\u0008\u000B-\u001F\u007F]'
    )
  ),
  -- WF-093 (FR-PING-4): one reply per ping, either a one-tap reply
  -- (PING_REPLIES in @whosfree/shared) or short plain text, never both.
  reply text check (reply is null or reply in ('I''m down', 'In 10', 'Can''t right now')),
  reply_text text check (
    reply_text is null
    or (
      char_length(reply_text) between 1 and 140
      and reply_text !~ '^\s|\s$'
      and reply_text !~ '[\u0001-\u0008\u000B-\u001F\u007F]'
    )
  ),
  replied_at timestamptz,
  -- When the recipient read the ping, and when the sender read the reply.
  -- Each is shown only to that person (see the grants below).
  read_at timestamptz,
  reply_read_at timestamptz,
  -- FR-PING-9: 2 hours after sending. Enforced by WF-097.
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint pings_not_self check (sender_id <> recipient_id),
  constraint pings_has_content check (template is not null or text is not null),
  constraint pings_one_reply check (reply is null or reply_text is null),
  constraint pings_replied_at check ((replied_at is null) = (reply is null and reply_text is null)),
  constraint pings_reply_read_needs_reply check (reply_read_at is null or replied_at is not null),
  constraint pings_expires_after_created check (expires_at > created_at)
);
-- PRD §9: the inbox reads by recipient, newest first; the "Sent" tab by sender.
create index pings_recipient_id_created_at_idx on public.pings (recipient_id, created_at desc);
create index pings_sender_id_created_at_idx on public.pings (sender_id, created_at desc);
create index pings_created_at_idx on public.pings (created_at);
create index pings_group_id_idx on public.pings (group_id) where group_id is not null;

comment on table public.pings is
  'Pings (PRD §9, WF-092/093). Readable by sender and recipient under RLS (not read_at/reply_read_at); written only by send_ping, reply_to_ping and mark_pings_read. Purged after 30 days (D32).';

-- ---------------------------------------------------------------------------
-- Privileges and RLS. The sender and the recipient can read their own pings
-- (without the read flags, so nobody gets read receipts), except with someone
-- they have blocked. Nobody writes directly. The app reads through
-- list_inbox, which also hides people who blocked the caller and adds their
-- public profile. service_role keeps Supabase's default access.
-- ---------------------------------------------------------------------------
alter table public.pings enable row level security;

revoke all on table public.pings from anon, authenticated;
grant select (
  id, sender_id, recipient_id, group_id, template, text, reply, reply_text, replied_at,
  expires_at, created_at
) on table public.pings to authenticated;

create policy pings_select_party on public.pings
  for select to authenticated
  using (
    (select public.current_user_id()) in (sender_id, recipient_id)
    -- blocks is readable by the blocker only (RLS), so this hides pings with
    -- people the caller blocked and reveals nothing to the blocked person.
    and not exists (
      select 1
      from public.blocks bl
      where bl.blocker_id = (select public.current_user_id())
        and bl.blocked_id in (pings.sender_id, pings.recipient_id)
    )
  );

-- ---------------------------------------------------------------------------
-- private.clean_ping_text(raw): the text without surrounding whitespace, or
-- null when blank, with CRLF line endings turned into LF. Raises 22023 when
-- it is longer than 140 characters or has control characters other than tab
-- and newline (D31). The message never repeats the text (NFR-SEC-11).
-- Same rules as PingText in @whosfree/shared.
-- ---------------------------------------------------------------------------
create function private.clean_ping_text(raw text) returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  -- Windows line endings become newlines; any other carriage return is refused.
  cleaned text := nullif(
    pg_catalog.regexp_replace(
      pg_catalog.replace(raw, E'\r\n', E'\n'), '^\s+|\s+$', '', 'g'
    ),
    ''
  );
begin
  if cleaned is null then
    return null;
  end if;
  if pg_catalog.char_length(cleaned) > 140 or cleaned ~ '[\u0001-\u0008\u000B-\u001F\u007F]' then
    raise exception 'Ping text must be 1 to 140 characters of plain text' using errcode = '22023';
  end if;
  return cleaned;
end;
$$;

revoke all on function private.clean_ping_text(text) from public;

-- ---------------------------------------------------------------------------
-- private.ping_status(target, at_time): `target`'s status at `at_time` for
-- the FR-PING-1 check, following the engine's precedence (PRD §6.6,
-- @whosfree/availability `timeline`):
--
--   1. paused         sharing paused (exact)
--   2. manual status  the active override that started last; `focused` is
--                     `busy` (exact)
--   3. no_schedule    no schedule source of their own (exact; an offline
--                     friend's doesn't count, D44)
--   4. busy           a busy ONE-OFF event covering at_time (exact for those)
--   5. away           outside available hours in their timezone (exact)
--   6. free
--
-- APPROXIMATE: recurring events (rrule) are not expanded here, and the
-- minimum-gap rule (FR-AVL-8) and all-day Google events (FR-GCAL-6) are not
-- applied, so someone in a recurring class can come out `free` here while the
-- Now screen (which runs the engine) shows `busy`. That only skips the
-- "Ping anyway?" confirmation, which the UI asks for from the engine's status
-- anyway. The statuses that block a ping, `dnd` and `paused`, come only from
-- steps 1-2, which are exact, so blocking is always enforced here.
--
-- Returns null when there is no such user.
-- ---------------------------------------------------------------------------
create function private.ping_status(target uuid, at_time timestamptz) returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  paused boolean;
  tz text;
  manual text;
  hours jsonb;
  local_at timestamp;
  local_day text;
  local_time text;
begin
  select u.sharing_paused, u.timezone into paused, tz
  from public.users u
  where u.id = ping_status.target;
  if not found then
    return null;
  end if;
  if paused then
    return 'paused';
  end if;

  -- Ties go to the later id, as visible_overrides orders them for the engine.
  select o.status into manual
  from public.status_overrides o
  where o.user_id = ping_status.target
    and o.starts_at <= ping_status.at_time
    and (o.ends_at is null or o.ends_at > ping_status.at_time)
  order by o.starts_at desc, o.id desc
  limit 1;
  if manual is not null then
    return case when manual = 'focused' then 'busy' else manual end;
  end if;

  if not exists (
    select 1 from public.sources s
    where s.user_id = ping_status.target and s.offline_friend_id is null
  ) then
    return 'no_schedule';
  end if;

  if exists (
    select 1
    from public.events e
    join public.sources s on s.id = e.source_id
    where e.user_id = ping_status.target
      and e.offline_friend_id is null
      and s.offline_friend_id is null
      and e.busy
      and e.rrule is null
      and e.starts_at <= ping_status.at_time
      and e.ends_at > ping_status.at_time
  ) then
    return 'busy';
  end if;

  -- Every user has a prefs row (created with the users row); the engine's
  -- default (DEFAULT_AVAILABLE_HOURS, 08:00-22:00 every day) covers a missing one.
  select ap.weekly into hours from public.availability_prefs ap where ap.user_id = ping_status.target;
  if hours is null then
    hours := (
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object('day', d, 'start', '08:00', 'end', '22:00')
      )
      from unnest(array['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']) d
    );
  end if;

  local_at := ping_status.at_time at time zone tz;
  -- 'Dy' is the English abbreviation whatever the locale (only 'TMDy' is localised).
  local_day := pg_catalog.lower(pg_catalog.to_char(local_at, 'Dy'));
  local_time := pg_catalog.to_char(local_at, 'HH24:MI');
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(hours) h
    where h.value ->> 'day' = local_day
      and (h.value ->> 'start') collate "C" <= local_time collate "C"
      and local_time collate "C" < (h.value ->> 'end') collate "C"
  ) then
    return 'free';
  end if;
  return 'away';
end;
$$;

revoke all on function private.ping_status(uuid, timestamptz) from public;

-- ---------------------------------------------------------------------------
-- private.signal_inbox_changed(recipients): sends `inbox_changed` with an
-- empty payload to each recipient's private channel (see the header). Called
-- by the ping functions, which are security definer; this helper isn't.
-- realtime.send() never raises, so a Realtime problem can't block a ping.
-- ---------------------------------------------------------------------------
create function private.signal_inbox_changed(recipients uuid[]) returns void
language plpgsql
volatile
set search_path = ''
as $$
declare
  recipient uuid;
begin
  for recipient in
    select distinct r.id
    from unnest(signal_inbox_changed.recipients) as r (id)
    where r.id is not null
    order by r.id
  loop
    perform realtime.send('{}'::jsonb, 'inbox_changed', 'user:' || recipient::text, true);
  end loop;
end;
$$;

revoke all on function private.signal_inbox_changed(uuid[]) from public;

-- ---------------------------------------------------------------------------
-- public.send_ping(recipient, template, message, confirmed): sends a ping from
-- the caller to `recipient` and returns who to notify. See the header for
-- every rule. `template` is one of PING_TEMPLATES or null, `message` is the
-- free text or null (blank counts as null); at least one is needed (D14).
-- `confirmed` is true once the sender has answered "Ping anyway?" for
-- someone who isn't free.
--
-- Returns one row:
--   ping_id       the new ping
--   recipient_id  the user to deliver Web Push to (the only id the server
--                 may notify for this ping)
--   sender_name   the caller's own display name, for the notification title
--   notify        whether to send Web Push (always true until WF-094 adds
--                 mutes and quiet hours; the ping is in the inbox either way)
-- ---------------------------------------------------------------------------
create function public.send_ping(
  recipient uuid,
  template text default null,
  message text default null,
  confirmed boolean default false
)
returns table (ping_id uuid, recipient_id uuid, sender_name text, notify boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  -- PING_TEMPLATES in @whosfree/shared.
  ping_templates constant text[] := array['Free for food?', 'Wanna study?', 'Link up?', 'Call me'];
  me uuid := private.require_user();
  target uuid := send_ping.recipient;
  clean_template text := nullif(pg_catalog.btrim(send_ping.template), '');
  clean_message text := private.clean_ping_text(send_ping.message);
  target_status text;
  new_id uuid;
begin
  if clean_template is not null and not (clean_template = any (ping_templates)) then
    raise exception 'Unknown ping template' using errcode = '22023';
  end if;
  if clean_template is null and clean_message is null then
    raise exception 'A ping needs a template or a message' using errcode = '22023';
  end if;
  if target is null then
    raise exception 'User not found' using errcode = 'WF201';
  end if;
  if target = me then
    raise exception 'You can''t ping yourself' using errcode = 'WF202';
  end if;

  perform private.lock_pair(me, target);

  if exists (
    select 1 from public.blocks bl where bl.blocker_id = me and bl.blocked_id = target
  ) then
    raise exception 'You have blocked this user' using errcode = 'WF206';
  end if;
  -- FR-PING-1: friends and fellow group members only, never across a block
  -- (either way). A blocked sender gets exactly what a missing user gives.
  if not exists (select 1 from private.connections(me) c where c.user_id = target) then
    raise exception 'User not found' using errcode = 'WF201';
  end if;

  -- FR-PING-1: dnd and paused are blocked; anything but free needs a confirmation.
  target_status := private.ping_status(target, pg_catalog.now());
  if target_status in ('dnd', 'paused') then
    raise exception 'They can''t be pinged right now'
      using errcode = 'WF301', detail = target_status;
  end if;
  if target_status <> 'free' and not coalesce(send_ping.confirmed, false) then
    raise exception 'Confirm before pinging someone who isn''t free'
      using errcode = 'WF302', detail = target_status;
  end if;

  -- NFR-SEC-9 / FR-PING-6: 30 a day per sender. Counted only when the ping is
  -- stored (a later failure rolls the counter back).
  -- TODO(WF-094, FR-PING-6): 3 an hour per sender and recipient ('ping_to:<id>').
  perform private.consume_rate_limit(me, 'ping', 30, interval '1 day');

  insert into public.pings (sender_id, recipient_id, template, text, expires_at)
  values (me, target, clean_template, clean_message, pg_catalog.now() + interval '2 hours')
  returning pings.id into new_id;

  perform private.signal_inbox_changed(array[target, me]);

  -- TODO(WF-094, FR-PING-7): notify = false when the recipient muted the
  -- sender or is in quiet hours.
  return query
    select new_id, target, u.name, true
    from public.users u
    where u.id = me;
end;
$$;

comment on function public.send_ping(uuid, text, text, boolean) is
  'WF-092: sends a ping (template and/or ≤140-character text) to a connection, enforcing blocks, dnd/paused, the busy/away confirmation and 30 a day. Returns ping_id, recipient_id, sender_name and notify for Web Push.';

revoke all on function public.send_ping(uuid, text, text, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.send_ping(uuid, text, text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- public.list_inbox(): the caller's pings from the last 30 days (D32),
-- received and sent, newest first, at most 200.
--
-- Columns:
--   id, direction        'received' or 'sent'
--   other_id, other_name, other_handle, other_avatar_url
--                        the other person's public profile, through
--                        private.visible_profile: pings with anyone blocked
--                        in either direction are left out (FR-SOC-6)
--   template, text       the ping (plain text, D31)
--   reply, reply_text, replied_at
--                        the recipient's reply (WF-093), if any
--   created_at, expires_at
--   unread               received: the caller hasn't read the ping;
--                        sent: there is a reply the caller hasn't read
-- Nothing else about the other person (no schedule, status or read state).
-- ---------------------------------------------------------------------------
create function public.list_inbox()
returns table (
  id uuid,
  direction text,
  other_id uuid,
  other_name text,
  other_handle text,
  other_avatar_url text,
  template text,
  text text,
  reply text,
  reply_text text,
  replied_at timestamptz,
  created_at timestamptz,
  expires_at timestamptz,
  unread boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.id,
    case when p.recipient_id = me.id then 'received' else 'sent' end,
    prof.id,
    prof.name,
    prof.handle,
    prof.avatar_url,
    p.template,
    p.text,
    p.reply,
    p.reply_text,
    p.replied_at,
    p.created_at,
    p.expires_at,
    case
      when p.recipient_id = me.id then p.read_at is null
      else p.replied_at is not null and p.reply_read_at is null
    end
  from (select public.current_user_id() as id) me
  join public.pings p on me.id in (p.sender_id, p.recipient_id)
  cross join lateral private.visible_profile(
    me.id,
    case when p.recipient_id = me.id then p.sender_id else p.recipient_id end
  ) prof
  where p.created_at > pg_catalog.now() - interval '30 days'
  order by p.created_at desc, p.id
  limit 200
$$;

comment on function public.list_inbox() is
  'WF-092: the caller''s received and sent pings (last 30 days, newest first, max 200) with the other person''s public profile and the caller''s own unread flag; blocked people (either way) are left out.';

revoke all on function public.list_inbox() from public, anon, authenticated, service_role;
grant execute on function public.list_inbox() to authenticated;

-- ---------------------------------------------------------------------------
-- public.mark_pings_read(ping_ids): marks the caller's unread received pings
-- as read, and unread replies to the caller's sent pings as read. Only the
-- given ids, or all of them when ping_ids is null. Other people's pings and
-- unknown ids are ignored. Returns how many pings changed. Sends no signal:
-- the inbox that called it already shows the change.
-- ---------------------------------------------------------------------------
create function public.mark_pings_read(ping_ids uuid[] default null)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := private.require_user();
  received integer;
  replies integer;
begin
  update public.pings p
  set read_at = pg_catalog.now()
  where p.recipient_id = me
    and p.read_at is null
    and (mark_pings_read.ping_ids is null or p.id = any (mark_pings_read.ping_ids));
  get diagnostics received = row_count;

  update public.pings p
  set reply_read_at = pg_catalog.now()
  where p.sender_id = me
    and p.replied_at is not null
    and p.reply_read_at is null
    and (mark_pings_read.ping_ids is null or p.id = any (mark_pings_read.ping_ids));
  get diagnostics replies = row_count;

  return received + replies;
end;
$$;

comment on function public.mark_pings_read(uuid[]) is
  'WF-092: marks the caller''s received pings and replies to their sent pings as read (the given ids, or all when null). Returns how many changed.';

revoke all on function public.mark_pings_read(uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.mark_pings_read(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- public.unread_ping_count(): the inbox badge: unread received pings plus
-- unread replies to sent ones, within list_inbox's 30 days and leaving out
-- blocked people (either way), so it always matches the inbox. 0 without an
-- account.
-- ---------------------------------------------------------------------------
create function public.unread_ping_count()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from (select public.current_user_id() as id) me
  join public.pings p on me.id in (p.sender_id, p.recipient_id)
  where p.created_at > pg_catalog.now() - interval '30 days'
    and (
      (p.recipient_id = me.id and p.read_at is null)
      or (p.sender_id = me.id and p.replied_at is not null and p.reply_read_at is null)
    )
    and not private.is_blocked(p.sender_id, p.recipient_id)
$$;

comment on function public.unread_ping_count() is
  'WF-092: unread received pings plus unread replies to sent pings (last 30 days, no blocked people).';

revoke all on function public.unread_ping_count() from public, anon, authenticated, service_role;
grant execute on function public.unread_ping_count() to authenticated;

-- ---------------------------------------------------------------------------
-- private.purge_old_pings(retention): deletes pings older than `retention`
-- (default 30 days, D32 / NFR-COMP-8) and returns how many. For the
-- retention cron (WF-037, FR-ADM-4), which runs as postgres.
-- ---------------------------------------------------------------------------
create function private.purge_old_pings(retention interval default interval '30 days')
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

  delete from public.pings p where p.created_at < pg_catalog.now() - retention;
  get diagnostics deleted = row_count;
  return deleted;
end;
$$;

revoke all on function private.purge_old_pings(interval) from public;
