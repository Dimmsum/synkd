// WF-127: offline friends, the database half. Adding, editing, deleting and
// listing them, the cap and the permission tick, their schedule rows, and the
// core promise: nobody but the owner can read an offline friend or their
// events through any table or function, and their events never count as the
// owner's own schedule (FR-SOC-14, FR-SOC-15, FR-SOC-16, FR-SOC-18,
// NFR-COMP-9, R14, D44).

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MAX_OFFLINE_FRIENDS, OFFLINE_FRIEND_NICKNAME_MAX_LENGTH } from '@whosfree/shared';
import { OFFLINE_FRIEND_ERRORS } from '../src/index';
import { createTestDb } from './harness/db';
import type { NowConnection } from '../src/index';
import type { TestDb } from './harness/db';
import { codeOf } from './harness/errors';
import { expectNoExecute, expectPgError, setRateCount } from './harness/groups';
import { addEvent, addGroup, addSource, addUser, befriend, setRule } from './harness/seed';

const RANGE = ['2026-10-05T00:00:00Z', '2026-10-06T00:00:00Z'] as const;
const NICKNAME = 'Tash the Secret';
const EMOJI = '🌸';
const OWN_TITLE = 'Owner lecture';
// Covers the whole of RANGE, so if it leaked into the owner's schedule every
// viewer would see the owner busy all day.
const FRIEND_TITLES = ['Tash all-day seminar', 'Tash weekly tutorial'];
const SECRETS = [NICKNAME, EMOJI, ...FRIEND_TITLES];

let db: TestDb;
let owner: string;
let friend: string;
let comember: string;
let groupId: string;
let offlineId: string;
let offlineSource: string;
let offlineEventIds: string[];
let ownEventId: string;

beforeAll(async () => {
  db = await createTestDb();
});
afterAll(() => db.close());

beforeEach(async () => {
  await db.reset();
  owner = await addUser(db, 'user_owner', { handle: 'owner_h' });
  friend = await addUser(db, 'user_friend', { handle: 'friend_h' });
  comember = await addUser(db, 'user_comember');
  // No connection to the owner at all.
  await addUser(db, 'user_stranger');

  // The friend and the group co-member both get T3 (titles) of the owner.
  await befriend(db, owner, friend);
  await setRule(db, owner, 'friend', friend, 3);
  await setRule(db, friend, 'friend', owner, 3);
  groupId = await addGroup(db, owner, [comember]);
  await setRule(db, owner, 'group', groupId, 3);
  await setRule(db, comember, 'group', groupId, 3);

  const ownSource = await addSource(db, owner);
  ownEventId = await addEvent(db, owner, ownSource, {
    title: OWN_TITLE,
    category: 'class',
    startsAt: '2026-10-05T14:00:00Z',
    endsAt: '2026-10-05T15:00:00Z',
  });

  offlineId = await createOffline('user_owner', NICKNAME, EMOJI);
  offlineSource = await addSource(db, owner, { offlineFriendId: offlineId });
  offlineEventIds = [
    await addEvent(db, owner, offlineSource, {
      title: FRIEND_TITLES[0],
      category: 'class',
      startsAt: '2026-10-05T00:00:00Z',
      endsAt: '2026-10-06T00:00:00Z',
      offlineFriendId: offlineId,
    }),
    await addEvent(db, owner, offlineSource, {
      title: FRIEND_TITLES[1],
      category: 'tutorial',
      startsAt: '2026-09-28T09:00:00Z',
      endsAt: '2026-09-28T11:00:00Z',
      rrule: 'FREQ=WEEKLY',
      offlineFriendId: offlineId,
    }),
  ];
});

async function createOffline(
  clerkId: string,
  nickname: string | null = 'Tash',
  emoji: string | null = null,
  permission: boolean | null = true,
): Promise<string> {
  const [row] = await db
    .asUser(clerkId)
    .query<{ id: string }>(`select public.create_offline_friend($1, $2, $3) as id`, [
      nickname,
      emoji,
      permission,
    ]);
  if (row === undefined) throw new Error('create_offline_friend returned no row');
  return row.id;
}

async function offlineRows(userId: string): Promise<Record<string, unknown>[]> {
  const { rows } = await db.admin.query<Record<string, unknown>>(
    `select nickname, emoji from public.offline_friends where user_id = $1 order by created_at, id`,
    [userId],
  );
  return rows;
}

async function count(sql: string, params: unknown[] = []): Promise<number> {
  const { rows } = await db.admin.query<{ n: number }>(
    `select count(*)::integer as n from ${sql}`,
    params,
  );
  return rows[0]?.n ?? -1;
}

function eventsFor(clerkId: string, ownerId: string) {
  return db
    .asUser(clerkId)
    .query<{ id: string; title: string | null }>(
      `select id, title from public.events_for_viewer($1, $2, $3)`,
      [ownerId, ...RANGE],
    );
}

describe('create_offline_friend (FR-SOC-14, FR-SOC-16)', () => {
  it('adds one for the caller, trimmed, and records when permission was confirmed', async () => {
    const id = await createOffline('user_friend', '  Kim  ', '  🐢 ');
    const { rows } = await db.admin.query(
      `select user_id, nickname, emoji,
              permission_confirmed_at is not null and permission_confirmed_at = created_at as confirmed_now
       from public.offline_friends where id = $1`,
      [id],
    );
    expect(rows).toEqual([{ user_id: friend, nickname: 'Kim', emoji: '🐢', confirmed_now: true }]);
  });

  it('a blank emoji means none', async () => {
    await createOffline('user_friend', 'Kim', '   ');
    expect(await offlineRows(friend)).toEqual([{ nickname: 'Kim', emoji: null }]);
  });

  it.each([false, null])(
    'refuses without the permission tick (%s), creating nothing',
    async (tick) => {
      await expectPgError(
        createOffline('user_friend', 'Kim', null, tick),
        OFFLINE_FRIEND_ERRORS.permissionRequired,
        '22023',
      );
      await expectPgError(
        db.asUser('user_friend').query(`select public.create_offline_friend('Kim')`),
        OFFLINE_FRIEND_ERRORS.permissionRequired,
        '22023',
      );
      expect(await offlineRows(friend)).toEqual([]);
    },
  );

  it('checks the nickname like OfflineFriendNickname in @whosfree/shared', async () => {
    const max = OFFLINE_FRIEND_NICKNAME_MAX_LENGTH;
    for (const bad of ['', '   ', null, 'a'.repeat(max + 1)])
      await expectPgError(
        createOffline('user_friend', bad),
        OFFLINE_FRIEND_ERRORS.invalidNickname,
        '22023',
      );
    for (const bad of ['Ta\u0007sh', 'Ta\nsh'])
      await expectPgError(
        createOffline('user_friend', bad),
        OFFLINE_FRIEND_ERRORS.nicknameControlCharacters,
        '22023',
      );
    await createOffline('user_friend', 'a'.repeat(max));
    await createOffline('user_friend', '🍗'.repeat(max));
    expect(await offlineRows(friend)).toHaveLength(2);
  });

  it('checks the emoji like a group emoji', async () => {
    await expectPgError(
      createOffline('user_friend', 'Kim', 'x'.repeat(17)),
      OFFLINE_FRIEND_ERRORS.invalidEmoji,
      '22023',
    );
  });

  it('the table itself refuses an untrimmed or too long nickname and a missing confirmation', async () => {
    const insert = (nickname: string, confirmed: string | null) =>
      codeOf(
        db.admin.query(
          `insert into public.offline_friends (user_id, nickname, permission_confirmed_at)
           values ($1, $2, $3)`,
          [friend, nickname, confirmed],
        ),
      );
    expect(await insert(' Kim', 'now')).toBe('23514');
    expect(await insert('a'.repeat(41), 'now')).toBe('23514');
    expect(await insert('Kim', null)).toBe('23502');
    expect(await insert('Kim', 'now')).toBe('ok');
  });

  it(`allows at most MAX_OFFLINE_FRIENDS (${MAX_OFFLINE_FRIENDS}) per user (FR-SOC-18)`, async () => {
    for (let i = 1; i <= MAX_OFFLINE_FRIENDS; i++)
      await createOffline('user_friend', `Friend ${i}`);
    await expectPgError(
      createOffline('user_friend', 'One too many'),
      OFFLINE_FRIEND_ERRORS.limitReached,
      'P0001',
    );
    expect(await offlineRows(friend)).toHaveLength(MAX_OFFLINE_FRIENDS);
    // The cap is per user: the owner's one doesn't count towards it, nor theirs towards the owner's.
    expect(await offlineRows(owner)).toHaveLength(1);

    // Deleting one frees a place, but re-adding the same day is rate limited (anti-churn, R14).
    const [first] = await db.admin
      .query<{ id: string }>(`select id from public.offline_friends where user_id = $1 limit 1`, [
        friend,
      ])
      .then((r) => r.rows);
    await db.asUser('user_friend').query(`select public.delete_offline_friend($1)`, [first?.id]);
    await expectPgError(
      createOffline('user_friend', 'Replacement'),
      OFFLINE_FRIEND_ERRORS.rateLimited,
      'PT429',
    );
    await setRateCount(db, friend, 'create_offline_friend', 0);
    await createOffline('user_friend', 'Replacement');
    expect(await offlineRows(friend)).toHaveLength(MAX_OFFLINE_FRIENDS);
  });

  it('checks the cap while holding the caller’s users row lock, so concurrent adds can’t pass it', async () => {
    const locked = await db.asUser('user_friend').run(async (tx) => {
      await tx.query(`select public.create_offline_friend('Kim', null, true)`);
      await tx.query(`reset role`);
      const { rows } = await tx.query<{ locked: boolean }>(
        `select pg_current_xact_id()::text in (u.xmax::text, u.xmin::text) as locked
         from public.users u where u.id = $1`,
        [friend],
      );
      return rows[0]?.locked ?? false;
    });
    expect(locked).toBe(true);
  });

  it('is rate limited to 20 a day (NFR-SEC-9); a refused call uses nothing', async () => {
    await setRateCount(db, friend, 'create_offline_friend', 19);
    await expectPgError(
      createOffline('user_friend', 'Kim', null, false),
      OFFLINE_FRIEND_ERRORS.permissionRequired,
    );
    await createOffline('user_friend', 'Kim');
    await expectPgError(
      createOffline('user_friend', 'Lee'),
      OFFLINE_FRIEND_ERRORS.rateLimited,
      'PT429',
    );
    expect(await offlineRows(friend)).toEqual([{ nickname: 'Kim', emoji: null }]);
  });

  it('needs an account', async () => {
    await expectPgError(
      createOffline('user_no_row', 'Kim'),
      OFFLINE_FRIEND_ERRORS.noAccount,
      'WF001',
    );
  });
});

describe('update_offline_friend (FR-SOC-18)', () => {
  it('renames and sets the emoji, bumping updated_at', async () => {
    await db.admin.query(
      `update public.offline_friends set updated_at = updated_at - interval '1 day' where id = $1`,
      [offlineId],
    );
    await db
      .asUser('user_owner')
      .query(`select public.update_offline_friend($1, '  Natasha ', null)`, [offlineId]);
    const { rows } = await db.admin.query(
      `select nickname, emoji, updated_at > created_at as bumped from public.offline_friends where id = $1`,
      [offlineId],
    );
    expect(rows).toEqual([{ nickname: 'Natasha', emoji: null, bumped: true }]);
  });

  it('validates like create', async () => {
    const update = (nickname: string, emoji: string | null) =>
      db
        .asUser('user_owner')
        .query(`select public.update_offline_friend($1, $2, $3)`, [offlineId, nickname, emoji]);
    await expectPgError(update(' ', null), OFFLINE_FRIEND_ERRORS.invalidNickname, '22023');
    await expectPgError(update('Kim', 'x'.repeat(17)), OFFLINE_FRIEND_ERRORS.invalidEmoji, '22023');
    expect(await offlineRows(owner)).toEqual([{ nickname: NICKNAME, emoji: EMOJI }]);
  });

  it('another user’s offline friend is "not found" and stays as it was', async () => {
    for (const clerk of ['user_friend', 'user_comember', 'user_stranger'])
      await expectPgError(
        db
          .asUser(clerk)
          .query(`select public.update_offline_friend($1, 'Hacked', null)`, [offlineId]),
        OFFLINE_FRIEND_ERRORS.notFound,
        'P0002',
      );
    await expectPgError(
      db
        .asUser('user_owner')
        .query(`select public.update_offline_friend(gen_random_uuid(), 'Kim', null)`),
      OFFLINE_FRIEND_ERRORS.notFound,
      'P0002',
    );
    expect(await offlineRows(owner)).toEqual([{ nickname: NICKNAME, emoji: EMOJI }]);
  });
});

describe('delete_offline_friend (FR-SOC-18)', () => {
  it('deletes them with their whole schedule straight away, leaving the owner’s own', async () => {
    await db.asUser('user_owner').query(`select public.delete_offline_friend($1)`, [offlineId]);
    expect(await offlineRows(owner)).toEqual([]);
    expect(await count(`public.sources where offline_friend_id is not null`)).toBe(0);
    expect(await count(`public.events where offline_friend_id is not null`)).toBe(0);
    expect(await count(`public.events where id = any($1)`, [offlineEventIds])).toBe(0);
    expect(await count(`public.events where id = $1`, [ownEventId])).toBe(1);
  });

  it('another user’s offline friend is "not found" and nothing is deleted', async () => {
    for (const clerk of ['user_friend', 'user_comember', 'user_stranger'])
      await expectPgError(
        db.asUser(clerk).query(`select public.delete_offline_friend($1)`, [offlineId]),
        OFFLINE_FRIEND_ERRORS.notFound,
        'P0002',
      );
    expect(await offlineRows(owner)).toHaveLength(1);
    expect(await count(`public.events where offline_friend_id = $1`, [offlineId])).toBe(2);
  });

  it('deleting the owner’s account deletes their offline friends and schedules (NFR-COMP-9)', async () => {
    // (The owner administers the group; account deletion, WF-114, hands that on first.)
    await db.admin.query(`delete from public.groups where id = $1`, [groupId]);
    await db.admin.query(`delete from public.users where id = $1`, [owner]);
    expect(await count(`public.offline_friends`)).toBe(0);
    expect(await count(`public.sources where offline_friend_id is not null`)).toBe(0);
    expect(await count(`public.events where offline_friend_id is not null`)).toBe(0);
  });
});

describe('list_offline_friends', () => {
  it('returns the caller’s own, oldest first, with whether each has a schedule', async () => {
    const kim = await createOffline('user_owner', 'Kim', null);
    const rows = await db
      .asUser('user_owner')
      .query(`select id, nickname, emoji, has_schedule from public.list_offline_friends()`);
    expect(rows).toEqual([
      { id: offlineId, nickname: NICKNAME, emoji: EMOJI, has_schedule: true },
      { id: kim, nickname: 'Kim', emoji: null, has_schedule: false },
    ]);
  });

  it('returns nothing to anyone else, or to a token without an account', async () => {
    for (const clerk of ['user_friend', 'user_comember', 'user_stranger', 'user_no_row'])
      expect(await db.asUser(clerk).query(`select * from public.list_offline_friends()`)).toEqual(
        [],
      );
  });
});

describe('schedule rows (sources and events with offline_friend_id)', () => {
  it('the owner writes them directly under RLS, like their own schedule', async () => {
    await db.asUser('user_owner').run(async (tx) => {
      const {
        rows: [source],
      } = await tx.query<{ id: string }>(
        `insert into public.sources (user_id, type, offline_friend_id)
         values (public.current_user_id(), 'manual', $1) returning id`,
        [offlineId],
      );
      await tx.query(
        `insert into public.events (user_id, source_id, offline_friend_id, title, starts_at, ends_at)
         values (public.current_user_id(), $1, $2, 'Typed in', now(), now() + interval '1 hour')`,
        [source?.id, offlineId],
      );
    });
    expect(await count(`public.events where offline_friend_id = $1`, [offlineId])).toBe(3);
  });

  it('can’t point at another user’s offline friend (the FK makes owner = user_id)', async () => {
    const insertSource = `insert into public.sources (user_id, type, offline_friend_id)
                          values (public.current_user_id(), 'upload', $1)`;
    for (const clerk of ['user_friend', 'user_comember', 'user_stranger'])
      expect(await codeOf(db.asUser(clerk).query(insertSource, [offlineId]))).toBe('23503');
    // Not even server-side: the owner of the offline friend must be the row's user_id.
    expect(
      await codeOf(
        db.admin.query(
          `insert into public.sources (user_id, type, offline_friend_id) values ($1, 'upload', $2)`,
          [friend, offlineId],
        ),
      ),
    ).toBe('23503');
    expect(
      await codeOf(
        addEvent(db, friend, await addSource(db, friend), {
          startsAt: '2026-10-05T10:00:00Z',
          endsAt: '2026-10-05T11:00:00Z',
          offlineFriendId: offlineId,
        }),
      ),
    ).toBe('23514');
  });

  it('an event belongs to the same person as its source', async () => {
    const ownSource = await addSource(db, owner);
    const at = { startsAt: '2026-10-05T10:00:00Z', endsAt: '2026-10-05T11:00:00Z' };
    // The offline friend's source, but an event claiming to be the owner's, and vice versa.
    expect(await codeOf(addEvent(db, owner, offlineSource, at))).toBe('23514');
    expect(
      await codeOf(addEvent(db, owner, ownSource, { ...at, offlineFriendId: offlineId })),
    ).toBe('23514');
    // Moving an existing event to the other side, as the client.
    for (const sql of [
      `update public.events set offline_friend_id = null where id = $1`,
      `update public.events set source_id = '${ownSource}' where id = $1`,
    ])
      expect(await codeOf(db.asUser('user_owner').query(sql, [offlineEventIds[0]]))).toBe('23514');
    expect(
      await codeOf(
        db
          .asUser('user_owner')
          .query(`update public.events set offline_friend_id = $2 where id = $1`, [
            ownEventId,
            offlineId,
          ]),
      ),
    ).toBe('23514');
  });

  it('a source’s offline friend can’t be changed, either way', async () => {
    const ownSource = await addSource(db, owner);
    const other = await createOffline('user_owner', 'Kim');
    const update = (id: string, value: string | null) =>
      codeOf(
        db
          .asUser('user_owner')
          .query(`update public.sources set offline_friend_id = $2 where id = $1`, [id, value]),
      );
    expect(await update(offlineSource, null)).toBe('23514');
    expect(await update(offlineSource, other)).toBe('23514');
    expect(await update(ownSource, offlineId)).toBe('23514');
    // Other columns stay writable.
    expect(
      await codeOf(
        db
          .asUser('user_owner')
          .query(`update public.sources set status = 'failed' where id = $1`, [offlineSource]),
      ),
    ).toBe('ok');
  });

  it('an offline friend’s source can’t be a Google Calendar', async () => {
    expect(await codeOf(addSource(db, owner, { type: 'gcal', offlineFriendId: offlineId }))).toBe(
      '23514',
    );
  });
});

describe('nobody but the owner can read an offline friend or their events (FR-SOC-15)', () => {
  const OTHERS = ['user_friend', 'user_comember', 'user_stranger'] as const;

  it('the owner sees them in every table', async () => {
    const me = db.asUser('user_owner');
    expect(await me.query(`select id from public.offline_friends`)).toEqual([{ id: offlineId }]);
    expect(
      await me.query(`select id from public.sources where offline_friend_id = $1`, [offlineId]),
    ).toEqual([{ id: offlineSource }]);
    expect(
      (
        await me.query<{ id: string }>(
          `select id from public.events where offline_friend_id = $1`,
          [offlineId],
        )
      ).map((r) => r.id),
    ).toEqual(expect.arrayContaining(offlineEventIds));
  });

  it.each(OTHERS)('%s gets no rows from offline_friends, sources or events', async (clerk) => {
    const s = db.asUser(clerk);
    expect(await s.query(`select * from public.offline_friends`)).toEqual([]);
    expect(
      await s.query(
        `select * from public.sources where offline_friend_id is not null or user_id = $1`,
        [owner],
      ),
    ).toEqual([]);
    expect(
      await s.query(
        `select * from public.events where offline_friend_id is not null or user_id = $1`,
        [owner],
      ),
    ).toEqual([]);
  });

  it('the friend and co-member (both T3) see only the owner’s own events through events_for_viewer', async () => {
    for (const clerk of ['user_friend', 'user_comember']) {
      const rows = await eventsFor(clerk, owner);
      expect({ clerk, rows }).toEqual({ clerk, rows: [{ id: ownEventId, title: OWN_TITLE }] });
    }
    expect(await eventsFor('user_stranger', owner)).toEqual([]);
  });

  it('events_for_viewer returns nothing for an offline friend’s id, even to the owner', async () => {
    for (const clerk of ['user_owner', ...OTHERS])
      expect(await eventsFor(clerk, offlineId)).toEqual([]);
  });

  it('no client function returns anything about them to anyone else', async () => {
    const calls: [string, unknown[]][] = [
      [`select * from public.list_friends()`, []],
      [`select * from public.list_friend_requests()`, []],
      [`select * from public.list_blocked_users()`, []],
      [`select * from public.list_my_groups()`, []],
      [`select * from public.get_group_members($1)`, [groupId]],
      [`select * from public.get_profile($1)`, [owner]],
      [`select * from public.get_profile($1)`, [offlineId]],
      [`select * from public.find_user_by_handle('owner_h')`, []],
      [`select * from public.find_user_by_handle($1)`, [NICKNAME]],
      [`select * from public.account_status()`, []],
      [`select * from public.list_offline_friends()`, []],
      [`select * from public.events_for_viewer($1, $2, $3)`, [owner, ...RANGE]],
      [`select * from public.events_for_viewer($1, $2, $3)`, [offlineId, ...RANGE]],
      [`select * from public.now_for_viewer($1, $2)`, [...RANGE]],
    ];
    for (const clerk of OTHERS) {
      for (const [sql, params] of calls) {
        let payload: string;
        try {
          payload = JSON.stringify(await db.asUser(clerk).query(sql, params));
        } catch (error) {
          payload = String(error);
        }
        for (const secret of [...SECRETS, offlineId, offlineSource, ...offlineEventIds])
          expect({ clerk, sql, leaked: payload.includes(secret) }).toEqual({
            clerk,
            sql,
            leaked: false,
          });
      }
    }
  });

  it('signed-out (anon) requests can’t touch the tables or the functions', async () => {
    const anon = db.asAnon();
    for (const table of ['offline_friends', 'sources', 'events'])
      await expect(anon.query(`select * from public.${table}`)).rejects.toThrow(
        /permission denied for table/,
      );
    await expectNoExecute(
      anon.query(`select * from public.list_offline_friends()`),
      'list_offline_friends',
    );
    await expectNoExecute(
      anon.query(`select public.create_offline_friend('Kim', null, true)`),
      'create_offline_friend',
    );
    await expectNoExecute(
      anon.query(`select public.update_offline_friend($1, 'Kim', null)`, [offlineId]),
      'update_offline_friend',
    );
    await expectNoExecute(
      anon.query(`select public.delete_offline_friend($1)`, [offlineId]),
      'delete_offline_friend',
    );
    expect(await offlineRows(owner)).toEqual([{ nickname: NICKNAME, emoji: EMOJI }]);
  });

  it('a signed-in token without an account sees nothing', async () => {
    const s = db.asUser('user_no_row');
    expect(await s.query(`select * from public.offline_friends`)).toEqual([]);
    expect(await s.query(`select * from public.events`)).toEqual([]);
    expect(await s.query(`select * from public.sources`)).toEqual([]);
  });
});

describe('offline friends’ events are never the owner’s own schedule (D44)', () => {
  it('the owner’s own view through events_for_viewer leaves them out', async () => {
    expect(await eventsFor('user_owner', owner)).toEqual([{ id: ownEventId, title: OWN_TITLE }]);
  });

  it('with only an offline friend’s schedule, others see no events of the owner at all', async () => {
    await db.admin.query(
      `delete from public.sources where user_id = $1 and offline_friend_id is null`,
      [owner],
    );
    for (const clerk of ['user_owner', 'user_friend', 'user_comember'])
      expect(await eventsFor(clerk, owner)).toEqual([]);
  });

  it('the redaction path itself skips them, at every tier', async () => {
    for (const tier of [1, 2, 3]) {
      const { rows } = await db.admin.query<{ id: string }>(
        `select id from private.redacted_events($1, $2::smallint, $3, $4)`,
        [owner, tier, ...RANGE],
      );
      expect(rows.map((r) => r.id)).toEqual([ownEventId]);
    }
  });
});

describe('offline friends on the Now screen (D44, WF-064)', () => {
  async function ownerRow(clerkId: string): Promise<NowConnection | undefined> {
    const rows = await db
      .asUser(clerkId)
      .query<NowConnection & Record<string, unknown>>(
        `select * from public.now_for_viewer($1, $2)`,
        [...RANGE],
      );
    return rows.find((r) => r.user_id === owner);
  }

  it('viewers get only the owner’s own source and events, never an offline friend’s', async () => {
    for (const clerk of ['user_friend', 'user_comember']) {
      const row = await ownerRow(clerk);
      expect({ clerk, sources: row?.sources.length }).toEqual({ clerk, sources: 1 });
      expect(row?.sources.flatMap((s) => s.events.map((e) => e.id))).toEqual([ownEventId]);
      const text = JSON.stringify(row);
      for (const secret of [...SECRETS, offlineId, offlineSource, ...offlineEventIds])
        expect({ clerk, secret, leaked: text.includes(secret) }).toEqual({
          clerk,
          secret,
          leaked: false,
        });
    }
    expect(await ownerRow('user_stranger')).toBeUndefined();
  });

  it('an offline friend’s schedule never makes the owner has_schedule', async () => {
    await db.admin.query(
      `delete from public.sources where user_id = $1 and offline_friend_id is null`,
      [owner],
    );
    for (const clerk of ['user_friend', 'user_comember']) {
      expect({ clerk, row: await ownerRow(clerk) }).toMatchObject({
        clerk,
        row: { has_schedule: false, sources: [] },
      });
    }
  });

  it('writes to an offline friend’s schedule send no Realtime signal to the owner’s connections', async () => {
    const owners = db.asUser('user_owner');
    const signals = async () => (await db.admin.query(`select topic from realtime.messages`)).rows;
    await db.admin.query(`delete from realtime.messages`);

    const [source] = await owners.query<{ id: string }>(
      `insert into public.sources (user_id, offline_friend_id, type) values ($1, $2, 'manual')
       returning id`,
      [owner, offlineId],
    );
    const [event] = await owners.query<{ id: string }>(
      `insert into public.events (user_id, offline_friend_id, source_id, starts_at, ends_at)
       values ($1, $2, $3, '2026-10-05T10:00:00Z', '2026-10-05T11:00:00Z') returning id`,
      [owner, offlineId, source?.id],
    );
    await owners.query(`update public.events set ends_at = '2026-10-05T12:00:00Z' where id = $1`, [
      event?.id,
    ]);
    await owners.query(`delete from public.events where id = $1`, [event?.id]);
    await owners.query(`update public.sources set status = 'failed' where id = $1`, [source?.id]);
    await owners.query(`delete from public.sources where id = $1`, [source?.id]);
    await owners.query(`select public.delete_offline_friend($1)`, [offlineId]);
    expect(await signals()).toEqual([]);

    // The owner's own schedule still signals them.
    await owners.query(`update public.events set ends_at = '2026-10-05T16:00:00Z' where id = $1`, [
      ownEventId,
    ]);
    expect((await signals()).length).toBe(2);
  });
});
