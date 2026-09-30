-- WF-064: Realtime "changed" signals for the Now screen (PRD §8.1, §8.5,
-- FR-VIEW-3, NFR-PERF-3, D41).
--
-- When something a viewer's Now screen shows changes, a database trigger sends
-- a Supabase Realtime Broadcast to that viewer's private channel. The message
-- carries NO data (payload `{}`): the client re-fetches through
-- now_for_viewer, which redacts. Clients never subscribe to row changes
-- (postgres_changes) on other users' tables, which would bypass redaction.
--
-- Channel: `user:<users.id>`, one private channel per user, e.g.
--   user:6f1c0c1e-0d7a-4a7c-9a55-0a8f0b7d9e21
-- Event:   `now_changed`
--   (REALTIME_USER_CHANNEL_PREFIX and NOW_CHANGED_EVENT in @whosfree/shared.)
-- A client subscribes with its own users.id (current_user_id()) as a private
-- channel, e.g. supabase.channel(`user:${me}`, { config: { private: true } })
-- .on('broadcast', { event: 'now_changed' }, refetch), after giving Realtime
-- the Clerk token. The policy at the end lets a user join only their own
-- channel, and nobody can send on it from a client.
--
-- What signals whom (every trigger is statement-level and reads the changed
-- rows from transition tables, so a bulk write sends one signal per viewer):
--   events, sources, status_overrides, availability_prefs
--                     -> the owner's connections
--   users (name, handle, avatar, timezone, sharing_paused)
--                     -> the user's connections
--   visibility_rules  -> the connections the rule covers (the friend, or the
--                        group's members)
--   friendships       -> both people, when an accepted friendship starts or
--                        ends (pending requests don't change the Now screen)
--   group_members     -> the member and the group's other members (join,
--                        leave, removal, group deletion)
--   blocks            -> both people (either way, visibility changes)
-- "Connections" are private.connections: friends and group co-members, with
-- blocked pairs left out, so a blocked person never gets a signal from the
-- blocker's data.
--
-- Each viewer is signalled at most once per transaction (set_status, for
-- example, closes the old status and inserts a new one): the ids already
-- signalled are kept in the transaction-local setting whosfree.now_signalled.
-- Messages are delivered after commit; a rolled-back transaction sends none.

-- ---------------------------------------------------------------------------
-- private.signal_now_changed(recipients): sends `now_changed` with an empty
-- payload to each recipient's private channel, once per transaction.
--
-- realtime.send() (Supabase) inserts into realtime.messages and never raises:
-- a failure becomes a WARNING, so a Realtime problem can't block a write.
-- ---------------------------------------------------------------------------
create function private.signal_now_changed(recipients uuid[]) returns void
language plpgsql
volatile
set search_path = ''
as $$
declare
  signalled text := coalesce(pg_catalog.current_setting('whosfree.now_signalled', true), '');
  recipient uuid;
begin
  for recipient in
    select distinct r.id
    from unnest(signal_now_changed.recipients) as r (id)
    where r.id is not null
    order by r.id
  loop
    if pg_catalog.strpos(signalled, recipient::text) = 0 then
      perform realtime.send('{}'::jsonb, 'now_changed', 'user:' || recipient::text, true);
      signalled := signalled || recipient::text || ',';
    end if;
  end loop;
  perform pg_catalog.set_config('whosfree.now_signalled', signalled, true);
end;
$$;

revoke all on function private.signal_now_changed(uuid[]) from public;

-- ---------------------------------------------------------------------------
-- private.signal_connections_of(owners): signals every connection of each
-- owner.
-- ---------------------------------------------------------------------------
create function private.signal_connections_of(owners uuid[]) returns void
language sql
volatile
set search_path = ''
as $$
  select private.signal_now_changed(
    array(
      select c.user_id
      from (select distinct o.id from unnest(signal_connections_of.owners) as o (id)) ow
      cross join lateral private.connections(ow.id) c
    )
  )
$$;

revoke all on function private.signal_connections_of(uuid[]) from public;

-- ---------------------------------------------------------------------------
-- Trigger functions. They are security definer (owned by postgres) because
-- they fire for writes made by clients under RLS, and must read other users'
-- connections and write realtime.messages, which clients can't. They return
-- `trigger`, so they can't be called directly, and the private schema isn't
-- reachable by clients anyway. Transition tables are named new_rows/old_rows
-- on every trigger below.
-- ---------------------------------------------------------------------------

-- Rows with a user_id owner: events, sources, status_overrides,
-- availability_prefs.
create function private.signal_owner_rows_changed() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  owners uuid[] := '{}';
begin
  if tg_op <> 'DELETE' then
    owners := owners || array(select n.user_id from new_rows n);
  end if;
  if tg_op <> 'INSERT' then
    owners := owners || array(select o.user_id from old_rows o);
  end if;
  perform private.signal_connections_of(owners);
  return null;
end;
$$;

revoke all on function private.signal_owner_rows_changed() from public;

-- users: only the columns the Now screen shows or the engine uses.
create function private.signal_user_changed() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.signal_connections_of(
    array(
      select n.id
      from new_rows n
      join old_rows o on o.id = n.id
      where (n.name, n.handle, n.avatar_url, n.timezone, n.sharing_paused)
        is distinct from (o.name, o.handle, o.avatar_url, o.timezone, o.sharing_paused)
    )
  );
  return null;
end;
$$;

revoke all on function private.signal_user_changed() from public;

-- visibility_rules: the owner's connections that the rule covers.
create function private.signal_visibility_rules_changed() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  recipients uuid[] := '{}';
begin
  if tg_op <> 'DELETE' then
    recipients := recipients || array(
      select c.user_id
      from new_rows n
      cross join lateral private.connections(n.owner_id) c
      where (n.target_type = 'friend' and c.user_id = n.target_id)
         or (n.target_type = 'group' and exists (
              select 1 from public.group_members m
              where m.group_id = n.target_id and m.user_id = c.user_id
            ))
    );
  end if;
  if tg_op <> 'INSERT' then
    recipients := recipients || array(
      select c.user_id
      from old_rows o
      cross join lateral private.connections(o.owner_id) c
      where (o.target_type = 'friend' and c.user_id = o.target_id)
         or (o.target_type = 'group' and exists (
              select 1 from public.group_members m
              where m.group_id = o.target_id and m.user_id = c.user_id
            ))
    );
  end if;
  perform private.signal_now_changed(recipients);
  return null;
end;
$$;

revoke all on function private.signal_visibility_rules_changed() from public;

-- friendships: both people, when an accepted friendship is involved.
create function private.signal_friendships_changed() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  recipients uuid[] := '{}';
begin
  if tg_op <> 'DELETE' then
    recipients := recipients
      || array(select n.user_a from new_rows n where n.status = 'accepted')
      || array(select n.user_b from new_rows n where n.status = 'accepted');
  end if;
  if tg_op <> 'INSERT' then
    recipients := recipients
      || array(select o.user_a from old_rows o where o.status = 'accepted')
      || array(select o.user_b from old_rows o where o.status = 'accepted');
  end if;
  perform private.signal_now_changed(recipients);
  return null;
end;
$$;

revoke all on function private.signal_friendships_changed() from public;

-- group_members: the member, and the group's (remaining) other members that
-- aren't blocked either way with them.
create function private.signal_group_members_changed() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  recipients uuid[];
begin
  if tg_op = 'INSERT' then
    recipients := array(select n.user_id from new_rows n) || array(
      select m.user_id
      from new_rows n
      join public.group_members m on m.group_id = n.group_id
      where m.user_id <> n.user_id
        and not private.is_blocked(m.user_id, n.user_id)
    );
  else
    recipients := array(select o.user_id from old_rows o) || array(
      select m.user_id
      from old_rows o
      join public.group_members m on m.group_id = o.group_id
      where m.user_id <> o.user_id
        and not private.is_blocked(m.user_id, o.user_id)
    );
  end if;
  perform private.signal_now_changed(recipients);
  return null;
end;
$$;

revoke all on function private.signal_group_members_changed() from public;

-- blocks: both people.
create function private.signal_blocks_changed() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  recipients uuid[] := '{}';
begin
  if tg_op = 'INSERT' then
    recipients := array(select n.blocker_id from new_rows n)
      || array(select n.blocked_id from new_rows n);
  else
    recipients := array(select o.blocker_id from old_rows o)
      || array(select o.blocked_id from old_rows o);
  end if;
  perform private.signal_now_changed(recipients);
  return null;
end;
$$;

revoke all on function private.signal_blocks_changed() from public;

-- ---------------------------------------------------------------------------
-- Triggers. Postgres allows transition tables only on single-event triggers,
-- hence one trigger per event.
-- ---------------------------------------------------------------------------
create trigger events_signal_now_insert
  after insert on public.events
  referencing new table as new_rows
  for each statement execute function private.signal_owner_rows_changed();
create trigger events_signal_now_update
  after update on public.events
  referencing old table as old_rows new table as new_rows
  for each statement execute function private.signal_owner_rows_changed();
create trigger events_signal_now_delete
  after delete on public.events
  referencing old table as old_rows
  for each statement execute function private.signal_owner_rows_changed();

create trigger sources_signal_now_insert
  after insert on public.sources
  referencing new table as new_rows
  for each statement execute function private.signal_owner_rows_changed();
create trigger sources_signal_now_update
  after update on public.sources
  referencing old table as old_rows new table as new_rows
  for each statement execute function private.signal_owner_rows_changed();
create trigger sources_signal_now_delete
  after delete on public.sources
  referencing old table as old_rows
  for each statement execute function private.signal_owner_rows_changed();

create trigger status_overrides_signal_now_insert
  after insert on public.status_overrides
  referencing new table as new_rows
  for each statement execute function private.signal_owner_rows_changed();
create trigger status_overrides_signal_now_update
  after update on public.status_overrides
  referencing old table as old_rows new table as new_rows
  for each statement execute function private.signal_owner_rows_changed();
create trigger status_overrides_signal_now_delete
  after delete on public.status_overrides
  referencing old table as old_rows
  for each statement execute function private.signal_owner_rows_changed();

-- Prefs rows are created and deleted with their user, who has no connections
-- yet / whose friendships and memberships signal on their own, so only
-- updates matter.
create trigger availability_prefs_signal_now_update
  after update on public.availability_prefs
  referencing old table as old_rows new table as new_rows
  for each statement execute function private.signal_owner_rows_changed();

create trigger users_signal_now_update
  after update on public.users
  referencing old table as old_rows new table as new_rows
  for each statement execute function private.signal_user_changed();

create trigger visibility_rules_signal_now_insert
  after insert on public.visibility_rules
  referencing new table as new_rows
  for each statement execute function private.signal_visibility_rules_changed();
create trigger visibility_rules_signal_now_update
  after update on public.visibility_rules
  referencing old table as old_rows new table as new_rows
  for each statement execute function private.signal_visibility_rules_changed();
create trigger visibility_rules_signal_now_delete
  after delete on public.visibility_rules
  referencing old table as old_rows
  for each statement execute function private.signal_visibility_rules_changed();

create trigger friendships_signal_now_insert
  after insert on public.friendships
  referencing new table as new_rows
  for each statement execute function private.signal_friendships_changed();
create trigger friendships_signal_now_update
  after update on public.friendships
  referencing old table as old_rows new table as new_rows
  for each statement execute function private.signal_friendships_changed();
create trigger friendships_signal_now_delete
  after delete on public.friendships
  referencing old table as old_rows
  for each statement execute function private.signal_friendships_changed();

-- Updates of a membership (role, permissions) don't change the Now screen.
create trigger group_members_signal_now_insert
  after insert on public.group_members
  referencing new table as new_rows
  for each statement execute function private.signal_group_members_changed();
create trigger group_members_signal_now_delete
  after delete on public.group_members
  referencing old table as old_rows
  for each statement execute function private.signal_group_members_changed();

create trigger blocks_signal_now_insert
  after insert on public.blocks
  referencing new table as new_rows
  for each statement execute function private.signal_blocks_changed();
create trigger blocks_signal_now_delete
  after delete on public.blocks
  referencing old table as old_rows
  for each statement execute function private.signal_blocks_changed();

-- ---------------------------------------------------------------------------
-- Who may join a private channel (Supabase Realtime Authorization): a signed-in
-- user may receive Broadcast messages on `user:<their own users.id>` only.
-- Realtime checks this SELECT policy on realtime.messages, with
-- realtime.topic() set to the channel's topic and the user's JWT claims set,
-- when the client joins. There is deliberately no INSERT policy, so no client
-- can send on any user channel; only the triggers above (as postgres) do.
-- ---------------------------------------------------------------------------
create policy whosfree_user_channel_receive_own on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and (select realtime.topic()) = 'user:' || (select public.current_user_id())::text
  );

comment on policy whosfree_user_channel_receive_own on realtime.messages is
  'WF-064: a user may receive Broadcast messages only on their own channel, user:<users.id>. No INSERT policy: clients cannot send.';
