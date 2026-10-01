-- WF-093: ping replies (PRD §9 `pings.reply`/`replyText`; J3 step 3-4,
-- FR-PING-4, NFR-SEC-11, D31, D41, D43).
--
-- The recipient answers a ping once, in one tap ("I'm down", "In 10",
-- "Can't right now": PING_REPLIES in @whosfree/shared) or with short plain
-- text (1-140 characters, the same rules as ping text, D31). The sender is
-- then notified: reply_to_ping returns who to deliver Web Push to, and sends
-- `inbox_changed` to both people's channels.
--
-- Rules:
--   * Only the recipient can reply. Anyone else, an unknown id, and a ping
--     with someone blocked in either direction all get WF303 "Ping not
--     found", so a blocked person can't tell (FR-SOC-6, D43).
--   * One reply per ping (NG3: a nudge, not a conversation); a second gets
--     WF304. A reply is final.
--   * Not rate-limited: each reply answers one ping, and pings are limited.
--   * Replying needs no friendship any more (the ping was allowed when sent);
--     only a block stops it.
--   * TODO(WF-097, FR-PING-9): refuse replies after expires_at.
--   * TODO(WF-094, FR-PING-7): notify = false when the sender muted the
--     replier or is in quiet hours. Always true until then.
--
-- Errors (DB_ERROR and PING_ERRORS in packages/backend/src): WF001 no
-- account; WF303 ping not found; WF304 already replied; 22023 not exactly
-- one of a quick reply and a message, or a bad one.

-- ---------------------------------------------------------------------------
-- public.reply_to_ping(ping_id, reply, message): the caller (the ping's
-- recipient) replies with a quick reply or a message, not both.
--
-- Returns one row:
--   sender_id     the ping's sender, the only user the server may notify
--   replier_name  the caller's own display name, for the notification title
--   notify        whether to send Web Push (see the header)
-- ---------------------------------------------------------------------------
create function public.reply_to_ping(
  ping_id uuid,
  reply text default null,
  message text default null
)
returns table (sender_id uuid, replier_name text, notify boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  -- PING_REPLIES in @whosfree/shared.
  quick_replies constant text[] := array['I''m down', 'In 10', 'Can''t right now'];
  me uuid := private.require_user();
  clean_reply text := nullif(pg_catalog.btrim(reply_to_ping.reply), '');
  clean_message text := private.clean_ping_text(reply_to_ping.message);
  ping public.pings%rowtype;
begin
  if (clean_reply is null) = (clean_message is null) then
    raise exception 'Reply with a quick reply or a message' using errcode = '22023';
  end if;
  if clean_reply is not null and not (clean_reply = any (quick_replies)) then
    raise exception 'Unknown quick reply' using errcode = '22023';
  end if;

  select * into ping
  from public.pings p
  where p.id = reply_to_ping.ping_id
    and p.recipient_id = me;
  if not found then
    raise exception 'Ping not found' using errcode = 'WF303';
  end if;

  -- Same lock as send_ping and block_user, so a reply can't pass a block made
  -- at the same moment. Then lock the row and read it again.
  perform private.lock_pair(me, ping.sender_id);
  if private.is_blocked(me, ping.sender_id) then
    raise exception 'Ping not found' using errcode = 'WF303';
  end if;

  select * into ping
  from public.pings p
  where p.id = reply_to_ping.ping_id
  for update;
  if ping.replied_at is not null then
    raise exception 'Already replied' using errcode = 'WF304';
  end if;

  update public.pings p
  set reply = clean_reply,
      reply_text = clean_message,
      replied_at = pg_catalog.now()
  where p.id = ping.id;

  perform private.signal_inbox_changed(array[ping.sender_id, me]);

  return query
    select ping.sender_id, u.name, true
    from public.users u
    where u.id = me;
end;
$$;

comment on function public.reply_to_ping(uuid, text, text) is
  'WF-093: the recipient replies once to a ping, with a quick reply or ≤140-character text. Returns sender_id, replier_name and notify for Web Push.';

revoke all on function public.reply_to_ping(uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.reply_to_ping(uuid, text, text) to authenticated;
