// WF-064: Realtime "changed" signals for the Now screen (PRD §8.1, §8.5,
// FR-VIEW-3, NFR-PERF-3, D41). Database triggers send an empty Broadcast to
// each affected viewer's private channel, `user:<users.id>`; the RLS policy on
// realtime.messages lets a user join their own channel only.
//
// The Supabase shim's realtime.send() records every Broadcast as a row of
// realtime.messages, which these tests read.

import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NOW_CHANGED_EVENT, REALTIME_USER_CHANNEL_PREFIX, userChannel } from '@whosfree/shared';
import { createTestDb, migrationFiles } from './harness/db';
import type { TestDb } from './harness/db';
import { codeOf } from './harness/errors';
import {
  addEvent,
  addGroup,
  addSource,
  addUser,
  befriend,
  block,
  joinGroup,
  setRule,
} from './harness/seed';

interface Message {
  topic: string;
  event: string;
  payload: unknown;
  private: boolean;
  extension: string;
}

const SECRET_TITLE = 'Therapy at the clinic';

let db: TestDb;
// owner's connections: friend (a friend), member (in Netball with owner), both (friend and
// member). Not connections: fof (friend of friend), pending (request), stranger, blocker (in
// Netball but has blocked owner).
let owner: string;
let friend: string;
let member: string;
let both: string;
let fof: string;
let pending: string;
let stranger: string;
let blocker: string;
let netball: string;
let everyoneButOwner: string[];

beforeAll(async () => {
  db = await createTestDb();
});
afterAll(() => db.close());

beforeEach(async () => {
  await db.reset();
  owner = await addUser(db, 'user_owner');
  friend = await addUser(db, 'user_friend');
  member = await addUser(db, 'user_member');
  both = await addUser(db, 'user_both');
  fof = await addUser(db, 'user_fof');
  pending = await addUser(db, 'user_pending');
  stranger = await addUser(db, 'user_stranger');
  blocker = await addUser(db, 'user_blocker');
  await befriend(db, owner, friend);
  await befriend(db, owner, both);
  await befriend(db, friend, fof);
  await befriend(db, pending, owner, 'pending');
  netball = await addGroup(db, owner, [member, both, blocker], 'Netball');
  await block(db, blocker, owner);
  everyoneButOwner = [friend, member, both, fof, pending, stranger, blocker];
  await clearMessages();
});

async function clearMessages(): Promise<void> {
  await db.admin.query(`delete from realtime.messages`);
}

async function messages(): Promise<Message[]> {
  return (
    await db.admin.query<Message>(
      `select topic, event, payload, private, extension from realtime.messages order by id`,
    )
  ).rows;
}

/** The users signalled since the last clear, sorted, one entry per message. */
async function signalled(): Promise<string[]> {
  return (await messages()).map((m) => m.topic.slice(REALTIME_USER_CHANNEL_PREFIX.length)).sort();
}

const sorted = (ids: string[]) => [...ids].sort();

describe('what a signal looks like', () => {
  it('an empty now_changed Broadcast on the private channel user:<users.id>, with no event data', async () => {
    const source = await addSource(db, owner);
    await clearMessages();
    await db.asUser('user_owner').query(
      `insert into public.events (user_id, source_id, title, category, starts_at, ends_at)
       values ($1, $2, $3, 'meeting', '2026-10-05T14:00:00Z', '2026-10-05T15:00:00Z')`,
      [owner, source, SECRET_TITLE],
    );

    const sent = await messages();
    expect(sent.map((m) => m.topic).sort()).toEqual(
      sorted([friend, member, both]).map((id) => userChannel(id)),
    );
    for (const m of sent) {
      expect(m).toMatchObject({
        event: NOW_CHANGED_EVENT,
        payload: {},
        private: true,
        extension: 'broadcast',
      });
    }
    const text = JSON.stringify(sent);
    for (const leak of [SECRET_TITLE, 'meeting', '2026-10-05', owner])
      expect(text).not.toContain(leak);
  });

  it('the channel naming in SQL matches @whosfree/shared', async () => {
    const sql = (await Promise.all((await migrationFiles()).map((f) => readFile(f, 'utf8')))).join(
      '\n',
    );
    expect(sql).toContain(`'${REALTIME_USER_CHANNEL_PREFIX}' || recipient::text`);
    expect(sql).toContain(`'${NOW_CHANGED_EVENT}'`);
    expect(sql).toContain(
      `= '${REALTIME_USER_CHANNEL_PREFIX}' || (select public.current_user_id())`,
    );
  });
});

describe("a connection's own data changes -> their connections", () => {
  it('events: only friends and co-members, never friends of friends, pending, strangers or blockers', async () => {
    const source = await addSource(db, owner);
    await clearMessages();
    await addEvent(db, owner, source, {
      startsAt: '2026-10-05T14:00:00Z',
      endsAt: '2026-10-05T15:00:00Z',
    });
    expect(await signalled()).toEqual(sorted([friend, member, both]));
  });

  it('a bulk write signals each viewer once', async () => {
    const source = await addSource(db, owner);
    await clearMessages();
    await db.asUser('user_owner').query(
      `insert into public.events (user_id, source_id, starts_at, ends_at)
       select $1, $2, t, t + interval '1 hour'
       from generate_series(timestamptz '2026-10-05T08:00:00Z', '2026-10-05T12:00:00Z', '1 hour') t`,
      [owner, source],
    );
    expect(await signalled()).toEqual(sorted([friend, member, both]));

    // Deleting the source cascades to its events: still one signal per viewer.
    await clearMessages();
    await db.asUser('user_owner').query(`delete from public.sources where id = $1`, [source]);
    expect(await signalled()).toEqual(sorted([friend, member, both]));
  });

  it('events updated and deleted by the owner', async () => {
    const source = await addSource(db, owner);
    const event = await addEvent(db, owner, source, {
      startsAt: '2026-10-05T14:00:00Z',
      endsAt: '2026-10-05T15:00:00Z',
    });
    await clearMessages();
    await db
      .asUser('user_owner')
      .query(`update public.events set ends_at = '2026-10-05T16:00:00Z' where id = $1`, [event]);
    expect(await signalled()).toEqual(sorted([friend, member, both]));
    await clearMessages();
    await db.asUser('user_owner').query(`delete from public.events where id = $1`, [event]);
    expect(await signalled()).toEqual(sorted([friend, member, both]));
  });

  it('sources', async () => {
    await db
      .asUser('user_owner')
      .query(`insert into public.sources (user_id, type) values ($1, 'manual')`, [owner]);
    expect(await signalled()).toEqual(sorted([friend, member, both]));
  });

  it('a manual status: once per viewer per transaction (set_status closes the old one)', async () => {
    await db.asUser('user_owner').query(`select public.set_status('busy')`);
    expect(await signalled()).toEqual(sorted([friend, member, both]));

    await clearMessages();
    await db.asUser('user_owner').run(async (tx) => {
      await tx.query(`select public.set_status('dnd', 'Do not disturb')`);
      await tx.query(`select public.clear_status()`);
    });
    expect(await signalled()).toEqual(sorted([friend, member, both]));
  });

  it('available hours', async () => {
    await db.asUser('user_owner').query(`select public.set_day_hours('mon', '10:00', '14:00')`);
    expect(await signalled()).toEqual(sorted([friend, member, both]));
  });

  it('pausing sharing, profile and timezone changes, but not other users columns', async () => {
    await db.asUser('user_owner').query(`update public.users set sharing_paused = true`);
    expect(await signalled()).toEqual(sorted([friend, member, both]));

    for (const change of [
      `name = 'New name'`,
      `avatar_url = 'https://img.example/a.png'`,
      `timezone = 'America/New_York'`,
    ]) {
      await clearMessages();
      await db.asUser('user_owner').query(`update public.users set ${change}`);
      expect({ change, to: await signalled() }).toEqual({
        change,
        to: sorted([friend, member, both]),
      });
    }

    await clearMessages();
    await db.asUser('user_owner').query(`select public.set_handle('owner_1')`);
    expect(await signalled()).toEqual(sorted([friend, member, both]));

    await clearMessages();
    await db.admin.query(
      `update public.users set consent_version = 'v1', consent_at = now() where id = $1`,
      [owner],
    );
    await db.asUser('user_owner').query(`update public.users set name = name`);
    expect(await signalled()).toEqual([]);
  });

  it('a blocked person gets no signal from the blocker, and vice versa', async () => {
    await block(db, owner, friend);
    await clearMessages();
    await db.asUser('user_owner').query(`select public.set_status('away')`);
    expect(await signalled()).toEqual(sorted([member, both]));

    await clearMessages();
    await db.asUser('user_blocker').query(`select public.set_status('away')`);
    // blocker is in Netball with member and both, but has blocked owner.
    expect(await signalled()).toEqual(sorted([member, both]));
  });

  it('a rolled-back write sends nothing', async () => {
    await expect(
      db.asUser('user_owner').run(async (tx) => {
        await tx.query(`select public.set_status('busy')`);
        throw new Error('roll back');
      }),
    ).rejects.toThrow('roll back');
    expect(await messages()).toEqual([]);
  });
});

describe('tier changes -> the viewers the rule covers', () => {
  it('a friend rule signals that friend only', async () => {
    await setRule(db, owner, 'friend', friend, 1);
    await clearMessages();
    await db
      .asUser('user_owner')
      .query(
        `update public.visibility_rules set tier = 3 where target_type = 'friend' and target_id = $1`,
        [friend],
      );
    expect(await signalled()).toEqual([friend]);
  });

  it("a group rule signals the group's members (not blockers, not other friends)", async () => {
    await setRule(db, owner, 'group', netball, 1);
    await clearMessages();
    await db
      .asUser('user_owner')
      .query(
        `update public.visibility_rules set tier = 2 where target_type = 'group' and target_id = $1`,
        [netball],
      );
    expect(await signalled()).toEqual(sorted([member, both]));
  });
});

describe('connections change -> both sides', () => {
  it('friend requests: nothing while pending; both people on accept and unfriend', async () => {
    await db.asUser('user_owner').query(`select public.send_friend_request($1)`, [stranger]);
    expect(await signalled()).toEqual([]);

    await db.asUser('user_stranger').query(`select public.accept_friend_request($1, 2)`, [owner]);
    expect(await signalled()).toEqual(sorted([owner, stranger]));

    await clearMessages();
    await db.asUser('user_stranger').query(`select public.unfriend($1)`, [owner]);
    expect(await signalled()).toEqual(sorted([owner, stranger]));
  });

  it('joining a group: the new member and the members they can see', async () => {
    await joinGroup(db, netball, stranger);
    // blocker has blocked owner, not stranger, so both see each other.
    expect(await signalled()).toEqual(sorted([stranger, owner, member, both, blocker]));
  });

  it('leaving and deleting a group', async () => {
    await db.asUser('user_member').query(`select public.leave_group($1)`, [netball]);
    // blocker and owner don't see each other, but both see member.
    expect(await signalled()).toEqual(sorted([member, owner, both, blocker]));

    await clearMessages();
    await db.asUser('user_owner').query(`select public.delete_group($1)`, [netball]);
    expect(await signalled()).toEqual(sorted([owner, both, blocker]));
  });

  it('blocking and unblocking: both people', async () => {
    await db.asUser('user_owner').query(`select public.block_user($1)`, [friend]);
    expect(await signalled()).toEqual(sorted([owner, friend]));
    await clearMessages();
    await db.asUser('user_owner').query(`select public.unblock_user($1)`, [friend]);
    expect(await signalled()).toEqual(sorted([owner, friend]));
  });

  it('nobody outside the change hears about it', async () => {
    await db.asUser('user_owner').query(`select public.send_friend_request($1)`, [stranger]);
    await db.asUser('user_stranger').query(`select public.accept_friend_request($1)`, [owner]);
    const heard = await signalled();
    for (const id of everyoneButOwner.filter((u) => u !== stranger))
      expect(heard).not.toContain(id);
  });
});

describe('who may receive on a channel (RLS on realtime.messages)', () => {
  /** Rows of realtime.messages `clerkId` can read while Realtime checks `topic`. */
  function visibleOn(clerkId: string, topic: string): Promise<{ extension: string }[]> {
    return db.asUser(clerkId).run(async (tx) => {
      await tx.query(`select set_config('realtime.topic', $1, true)`, [topic]);
      return (await tx.query<{ extension: string }>(`select extension from realtime.messages`))
        .rows;
    });
  }

  beforeEach(async () => {
    await db.admin.query(
      `insert into realtime.messages (topic, extension, event, payload, private)
       values ($1, 'broadcast', 'now_changed', '{}', true),
              ($1, 'presence', null, '{}', true),
              ($2, 'broadcast', 'now_changed', '{}', true)`,
      [userChannel(friend), userChannel(member)],
    );
  });

  it('a user can join their own channel only, and only for Broadcast', async () => {
    const own = await visibleOn('user_friend', userChannel(friend));
    expect(own.length).toBeGreaterThan(0);
    // Presence rows are never visible, even on the user's own channel.
    expect(new Set(own.map((r) => r.extension))).toEqual(new Set(['broadcast']));

    expect(await visibleOn('user_friend', userChannel(member))).toEqual([]);
    expect(await visibleOn('user_friend', REALTIME_USER_CHANNEL_PREFIX)).toEqual([]);
    // A token with no users row has no channel.
    expect(await visibleOn('user_unknown', REALTIME_USER_CHANNEL_PREFIX)).toEqual([]);
  });

  it('anon can join no channel', async () => {
    const rows = await db.asAnon().run(async (tx) => {
      await tx.query(`select set_config('realtime.topic', $1, true)`, [userChannel(friend)]);
      return (await tx.query(`select 1 from realtime.messages`)).rows;
    });
    expect(rows).toEqual([]);
  });

  it('no client can send on a channel, not even their own', async () => {
    const insert = (clerkId: string, topic: string) =>
      db.asUser(clerkId).query(
        `insert into realtime.messages (topic, extension, event, payload, private)
           values ($1, 'broadcast', 'now_changed', '{}', true)`,
        [topic],
      );
    expect(await codeOf(insert('user_friend', userChannel(member)))).toBe('42501');
    expect(await codeOf(insert('user_friend', userChannel(friend)))).toBe('42501');

    // realtime.send as a client: the insert is refused (Supabase turns it into a WARNING).
    await clearMessages();
    await db
      .asUser('user_friend')
      .query(`select realtime.send('{}'::jsonb, 'now_changed', $1, true)`, [userChannel(member)]);
    expect(await messages()).toEqual([]);
  });
});
