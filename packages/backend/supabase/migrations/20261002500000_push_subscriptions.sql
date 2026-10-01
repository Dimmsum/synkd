-- WF-091: Web Push subscriptions, the database half (PRD §9 `pushSubscriptions`;
-- FR-PWA-4, FR-PING-3, NFR-COMPAT-2, NFR-SEC-1, NFR-SEC-2, NFR-SEC-9, D41).
--
-- One row per browser/device that turned notifications on. The browser's
-- PushSubscription gives an endpoint URL (at Google, Mozilla, Apple, ...) and
-- two keys that the server needs to encrypt a payload for that browser
-- (RFC 8291). Sending happens on the Next.js server with `web-push`
-- (apps/web/src/lib/push/send.ts).
--
-- Who can read what:
--   - Clients read their own rows under RLS and write only through
--     save_push_subscription / delete_push_subscription below, which take the
--     owner from current_user_id().
--   - Nobody can read another user's subscriptions through the Data API: there
--     is no cross-user function. Delivery to another user (a ping, WF-092) is
--     done by the Next.js server's push module with the secret key, reading
--     only the recipient's rows and only after an authorising database
--     function run as the sender has returned that recipient (see the WF-091
--     notes in apps/web/src/lib/push/send.ts). The endpoint and keys never
--     reach another user's browser.
--
-- Data minimisation (NFR-SEC-1): the PRD lists `userAgent`; we store only a
-- coarse, optional device label such as "Chrome on Android", written by the
-- client so the user can tell their devices apart. No raw user agent, no IP.
--
-- Errors (PUSH_SUBSCRIPTION_ERRORS in packages/backend/src/index.ts): WF001 no
-- account for this sign-in, 22023 bad argument, PT429 rate limited.

-- ---------------------------------------------------------------------------
-- push_subscriptions
-- ---------------------------------------------------------------------------
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  -- Deleting the account deletes its subscriptions.
  user_id uuid not null references public.users (id) on delete cascade,
  -- The push service URL. One row per endpoint across all users: a browser
  -- belongs to whoever last turned notifications on in it.
  endpoint text not null check (
    char_length(endpoint) between 12 and 2048 and endpoint ~ '^https://[^[:space:][:cntrl:]]+$'
  ),
  -- PushSubscription keys, base64url as the browser's toJSON() gives them:
  -- p256dh is a 65-byte P-256 public key (87 characters), auth a 16-byte
  -- secret (22 characters). Padding is accepted.
  p256dh text not null check (
    char_length(p256dh) between 80 and 100 and p256dh ~ '^[A-Za-z0-9_-]+={0,2}$'
  ),
  auth text not null check (
    char_length(auth) between 16 and 32 and auth ~ '^[A-Za-z0-9_-]+={0,2}$'
  ),
  -- Optional, e.g. "Safari on iPhone". Trimmed, 1–60 characters, no control
  -- characters (PUSH_DEVICE_LABEL_MAX_LENGTH in @whosfree/shared).
  device_label text check (
    device_label is null
    or (
      char_length(device_label) between 1 and 60
      and device_label !~ '^\s|\s$'
      and device_label !~ '[[:cntrl:]]'
    )
  ),
  created_at timestamptz not null default now(),
  -- Last time the browser re-saved it (the keys can change).
  updated_at timestamptz not null default now(),
  -- Last successful delivery, set by the server's push module.
  last_used_at timestamptz,
  constraint push_subscriptions_endpoint_key unique (endpoint)
);
create index push_subscriptions_user_id_idx on public.push_subscriptions (user_id);

comment on table public.push_subscriptions is
  'Web Push subscriptions, one row per device (WF-091, FR-PING-3). Owner-only under RLS; written by save/delete_push_subscription. At most MAX_PUSH_SUBSCRIPTIONS (10) per user. Delivery reads them server-side only.';

-- ---------------------------------------------------------------------------
-- private.clean_push_device_label(label): the label without surrounding
-- whitespace, or null when blank. 1–60 characters, no control characters.
-- ---------------------------------------------------------------------------
create function private.clean_push_device_label(label text) returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  cleaned text := nullif(pg_catalog.regexp_replace(label, '^\s+|\s+$', '', 'g'), '');
begin
  if cleaned is null then
    return null;
  end if;
  if pg_catalog.char_length(cleaned) > 60 or cleaned ~ '[[:cntrl:]]' then
    raise exception 'Invalid device label' using errcode = '22023';
  end if;
  return cleaned;
end;
$$;

revoke all on function private.clean_push_device_label(text) from public;

-- ---------------------------------------------------------------------------
-- save_push_subscription(endpoint, p256dh, auth, device_label): stores this
-- browser's subscription for the caller and returns its id. Idempotent: the
-- client can call it again with the same endpoint (for example when the keys
-- change) and the row is updated in place.
--
-- If another account had this endpoint (the browser was signed in to it
-- before), the row moves to the caller: the device now belongs to whoever
-- turned notifications on last, so the previous account's notifications stop
-- appearing on it.
--
-- A device new to the caller:
--   - is rate limited to 20 a day (NFR-SEC-9); re-saving one the caller
--     already has costs nothing;
--   - counts towards the cap (MAX_PUSH_SUBSCRIPTIONS = 10). At the cap, the
--     caller's least recently used device is dropped to make room: old phones
--     and cleared browsers never unsubscribe, so refusing would lock people
--     out. The cap is checked while holding the caller's users row lock, so
--     concurrent saves can't pass it.
-- ---------------------------------------------------------------------------
create function public.save_push_subscription(
  endpoint text,
  p256dh text,
  auth text,
  device_label text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  -- MAX_PUSH_SUBSCRIPTIONS in @whosfree/shared.
  max_subscriptions constant integer := 10;
  me uuid := private.require_user();
  clean_endpoint text := pg_catalog.btrim(save_push_subscription.endpoint);
  clean_p256dh text := pg_catalog.btrim(save_push_subscription.p256dh);
  clean_auth text := pg_catalog.btrim(save_push_subscription.auth);
  clean_label text := private.clean_push_device_label(save_push_subscription.device_label);
  existing public.push_subscriptions%rowtype;
  new_id uuid;
begin
  if clean_endpoint is null
    or pg_catalog.char_length(clean_endpoint) not between 12 and 2048
    or clean_endpoint !~ '^https://[^[:space:][:cntrl:]]+$' then
    raise exception 'Invalid push endpoint' using errcode = '22023';
  end if;
  if clean_p256dh is null or clean_auth is null
    or pg_catalog.char_length(clean_p256dh) not between 80 and 100
    or clean_p256dh !~ '^[A-Za-z0-9_-]+={0,2}$'
    or pg_catalog.char_length(clean_auth) not between 16 and 32
    or clean_auth !~ '^[A-Za-z0-9_-]+={0,2}$' then
    raise exception 'Invalid push subscription keys' using errcode = '22023';
  end if;

  perform 1 from public.users u where u.id = me for update;

  select * into existing
  from public.push_subscriptions s
  where s.endpoint = clean_endpoint
  for update;

  if existing.id is not null and existing.user_id = me then
    update public.push_subscriptions s
    set p256dh = clean_p256dh,
        auth = clean_auth,
        device_label = clean_label,
        updated_at = pg_catalog.now()
    where s.id = existing.id;
    return existing.id;
  end if;

  -- Only counted when the device is actually added (rolls back otherwise).
  perform private.consume_rate_limit(me, 'push_subscribe', 20, interval '1 day');

  if existing.id is not null then
    -- The browser was another account's: that account loses this device.
    delete from public.push_subscriptions s where s.id = existing.id;
  end if;

  -- Make room: keep the caller's (max - 1) most recently used devices.
  delete from public.push_subscriptions s
  where s.id in (
    select k.id
    from public.push_subscriptions k
    where k.user_id = me
    order by greatest(k.updated_at, coalesce(k.last_used_at, k.updated_at)) desc,
             k.created_at desc, k.id
    offset max_subscriptions - 1
  );

  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, device_label)
  values (me, clean_endpoint, clean_p256dh, clean_auth, clean_label)
  returning push_subscriptions.id into new_id;

  return new_id;
end;
$$;

comment on function public.save_push_subscription(text, text, text, text) is
  'WF-091: stores this browser''s Web Push subscription for the caller (FR-PWA-4). Idempotent per endpoint; a new device is rate limited (20 a day) and the least recently used one is dropped beyond 10.';

revoke all on function public.save_push_subscription(text, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- delete_push_subscription(endpoint): removes the caller's subscription for
-- this endpoint ("turn off notifications on this device", sign-out). Returns
-- whether a row was deleted. Idempotent, and another user's endpoint is
-- simply not found (false), whether or not it exists.
-- ---------------------------------------------------------------------------
create function public.delete_push_subscription(endpoint text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := private.require_user();
begin
  delete from public.push_subscriptions s
  where s.endpoint = pg_catalog.btrim(delete_push_subscription.endpoint)
    and s.user_id = me;
  return found;
end;
$$;

comment on function public.delete_push_subscription(text) is
  'WF-091: removes the caller''s Web Push subscription for this endpoint. Returns whether one was deleted.';

revoke all on function public.delete_push_subscription(text)
  from public, anon, authenticated, service_role;
grant execute on function public.delete_push_subscription(text) to authenticated;

-- ---------------------------------------------------------------------------
-- request_test_push(): authorises "Send a test notification" to the caller's
-- own devices and returns the recipient (the caller's users.id). Rate limited
-- to 10 an hour (NFR-SEC-9), since each one calls the push services.
--
-- This is the pattern every notification follows (D41): a database function,
-- run as the acting user, decides who may be notified and returns the
-- recipient; only then does the server deliver (apps/web lib/push/send.ts).
-- WF-092's send_ping does the same for a ping's recipient.
-- ---------------------------------------------------------------------------
create function public.request_test_push()
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := private.require_user();
begin
  perform private.consume_rate_limit(me, 'push_test', 10, interval '1 hour');
  return me;
end;
$$;

comment on function public.request_test_push() is
  'WF-091: authorises a test notification to the caller''s own devices (10 an hour) and returns the caller''s users.id.';

revoke all on function public.request_test_push() from public, anon, authenticated, service_role;
grant execute on function public.request_test_push() to authenticated;

-- ---------------------------------------------------------------------------
-- Privileges and RLS: the owner reads their own rows; nobody writes directly.
-- service_role keeps Supabase's default access (server-side delivery only:
-- read a recipient's rows, drop dead ones, set last_used_at).
-- ---------------------------------------------------------------------------
alter table public.push_subscriptions enable row level security;

revoke all on table public.push_subscriptions from anon, authenticated;
grant select on table public.push_subscriptions to authenticated;

create policy push_subscriptions_select_own on public.push_subscriptions
  for select to authenticated
  using (user_id = (select public.current_user_id()));
