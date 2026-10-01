// WF-092 (send pings, inbox) and WF-093 (replies): who may ping whom (FR-PING-1, FR-SOC-6,
// D43), the recipient's status rules (dnd/paused blocked, busy/away confirmed), the content
// rules (D14, D31), the daily limit (NFR-SEC-9), RLS isolation, the inbox, read state, replies
// (FR-PING-4) and the Realtime signal that carries nothing (D41, NFR-SEC-11).

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  INBOX_CHANGED_EVENT,
  PING_DAILY_LIMIT,
  PING_EXPIRY_MINUTES,
  PING_REPLIES,
  PING_TEMPLATES,
  userChannel,
} from '@whosfree/shared';
import { DB_ERROR, PING_ERRORS } from '../src/index';
import { createTestDb } from './harness/db';
import type { TestDb } from './harness/db';
import { codeOf, errorOf } from './harness/errors';
import { expectNoExecute, setRateCount } from './harness/groups';
import { addEvent, addGroup, addSource, addUser, befriend, block } from './harness/seed';

const SECRET = 'Meet me behind the library, bring the notes';

let db: TestDb;
// alice's connections: bob (friend), cara (in Netball with alice). Not connections: dan
// (stranger), erin (pending request from alice), fay (friend of bob only).
let alice: string;
let bob: string;
let cara: string;
let dan: string;
let erin: string;
let fay: string;

beforeAll(async () => {
  db = await createTestDb();
});
afterAll(() => db.close());

beforeEach(async () => {
  await db.reset();
  alice = await addUser(db, 'user_alice');
  bob = await addUser(db, 'user_bob');
  cara = await addUser(db, 'user_cara');
  dan = await addUser(db, 'user_dan');
  erin = await addUser(db, 'user_erin');
  fay = await addUser(db, 'user_fay');
  await befriend(db, alice, bob);
  await befriend(db, bob, fay);
  await befriend(db, alice, erin, 'pending');
  await addGroup(db, alice, [cara], 'Netball');
  // Everyone is free unless a test says otherwise (an "until I change it" free status beats
  // the clock, so these tests don't depend on the time of day).
  for (const id of [alice, bob, cara, dan, erin, fay]) await setOverride(id, 'free');
  await db.admin.query(`delete from realtime.messages`);
});

async function setOverride(userId: string, status: string): Promise<void> {
  await db.admin.query(`delete from public.status_overrides where user_id = $1`, [userId]);
  await db.admin.query(
    `insert into public.status_overrides (user_id, status, starts_at)
     values ($1, $2, now() - interval '1 minute')`,
    [userId, status],
  );
}

interface Sent {
  ping_id: string;
  recipient_id: string;
  sender_name: string;
  notify: boolean;
}

function ping(
  clerkId: string,
  recipient: string | null,
  opts: { template?: string | null; message?: string | null; confirmed?: boolean } = {},
): Promise<Sent> {
  return db
    .asUser(clerkId)
    .query<Sent & Record<string, unknown>>(`select * from public.send_ping($1, $2, $3, $4)`, [
      recipient,
      opts.template === undefined ? 'Free for food?' : opts.template,
      opts.message ?? null,
      opts.confirmed ?? false,
    ])
    .then((rows) => {
      expect(rows).toHaveLength(1);
      return rows[0] as Sent;
    });
}

interface Replied {
  sender_id: string;
  replier_name: string;
  notify: boolean;
}

function reply(
  clerkId: string,
  pingId: string,
  opts: { reply?: string | null; message?: string | null } = {},
): Promise<Replied> {
  return db
    .asUser(clerkId)
    .query<Replied & Record<string, unknown>>(`select * from public.reply_to_ping($1, $2, $3)`, [
      pingId,
      opts.reply === undefined ? "I'm down" : opts.reply,
      opts.message ?? null,
    ])
    .then((rows) => rows[0] as Replied);
}

interface InboxRow {
  id: string;
  direction: string;
  other_id: string;
  other_name: string;
  template: string | null;
  text: string | null;
  reply: string | null;
  reply_text: string | null;
  replied_at: Date | null;
  created_at: Date;
  expires_at: Date;
  unread: boolean;
}

const inbox = (clerkId: string) =>
  db.asUser(clerkId).query<InboxRow & Record<string, unknown>>(`select * from public.list_inbox()`);

const unread = async (clerkId: string) =>
  (await db.asUser(clerkId).query<{ n: number }>(`select public.unread_ping_count() as n`))[0]?.n;

async function pingCount(): Promise<number> {
  const { rows } = await db.admin.query<{ n: number }>(
    `select count(*)::int as n from public.pings`,
  );
  return rows[0]?.n ?? 0;
}

describe('send_ping: who can be pinged (FR-PING-1, FR-SOC-6)', () => {
  it('a friend: stores the ping and returns who to notify', async () => {
    const sent = await ping('user_alice', bob, { message: SECRET });
    expect(sent).toEqual({
      ping_id: expect.any(String),
      recipient_id: bob,
      sender_name: 'Name of user_alice',
      notify: true,
    });
    const { rows } = await db.admin.query(`select * from public.pings where id = $1`, [
      sent.ping_id,
    ]);
    expect(rows[0]).toMatchObject({
      sender_id: alice,
      recipient_id: bob,
      group_id: null,
      template: 'Free for food?',
      text: SECRET,
      reply: null,
      read_at: null,
    });
  });

  it('a fellow group member who is not a friend', async () => {
    expect((await ping('user_cara', alice)).recipient_id).toBe(alice);
  });

  it('expires after PING_EXPIRY_MINUTES (FR-PING-9)', async () => {
    const { ping_id } = await ping('user_alice', bob);
    const { rows } = await db.admin.query<{ minutes: number }>(
      `select extract(epoch from expires_at - created_at)::int / 60 as minutes
       from public.pings where id = $1`,
      [ping_id],
    );
    expect(rows[0]?.minutes).toBe(PING_EXPIRY_MINUTES);
  });

  it('strangers, pending requests and friends of friends look exactly like a missing user', async () => {
    const missing = await errorOf(ping('user_alice', crypto.randomUUID()));
    expect(missing).toEqual({ code: DB_ERROR.userNotFound, message: PING_ERRORS.userNotFound });
    for (const target of [dan, erin, fay])
      expect(await errorOf(ping('user_alice', target))).toEqual(missing);
    expect(await errorOf(ping('user_erin', alice))).toEqual(missing);
    expect(await errorOf(ping('user_alice', null))).toEqual(missing);
    expect(await pingCount()).toBe(0);
  });

  it('a blocked sender gets the missing-user error; the blocker is told they blocked them', async () => {
    const missing = await errorOf(ping('user_alice', crypto.randomUUID()));
    await block(db, bob, alice);
    expect(await errorOf(ping('user_alice', bob))).toEqual(missing);
    expect(await errorOf(ping('user_bob', alice))).toEqual({
      code: DB_ERROR.blockedByYou,
      message: PING_ERRORS.blockedByYou,
    });
    expect(await pingCount()).toBe(0);
  });

  it('a block between group co-members stops pings both ways', async () => {
    await block(db, alice, cara);
    expect(await codeOf(ping('user_cara', alice))).toBe(DB_ERROR.userNotFound);
    expect(await codeOf(ping('user_alice', cara))).toBe(DB_ERROR.blockedByYou);
  });

  it('not yourself', async () => {
    expect(await errorOf(ping('user_alice', alice))).toEqual({
      code: DB_ERROR.cannotTargetSelf,
      message: PING_ERRORS.cannotPingSelf,
    });
  });

  it('needs an account', async () => {
    expect(await codeOf(ping('user_nobody', bob))).toBe(DB_ERROR.noAccount);
  });

  it('anon cannot call any ping function', async () => {
    for (const [sql, fn] of [
      [`select public.send_ping(gen_random_uuid(), 'Call me')`, 'send_ping'],
      [`select public.reply_to_ping(gen_random_uuid(), 'In 10')`, 'reply_to_ping'],
      [`select * from public.list_inbox()`, 'list_inbox'],
      [`select public.mark_pings_read()`, 'mark_pings_read'],
      [`select public.unread_ping_count()`, 'unread_ping_count'],
    ] as const)
      await expectNoExecute(db.asAnon().query(sql), fn);
  });
});

describe('send_ping: the recipient’s status (FR-PING-1, enforced on the server)', () => {
  it('do not disturb and paused are blocked, even when confirmed', async () => {
    await setOverride(bob, 'dnd');
    const dnd = await errorOf(ping('user_alice', bob, { confirmed: true }));
    expect(dnd).toEqual({
      code: DB_ERROR.pingRecipientUnavailable,
      message: PING_ERRORS.recipientUnavailable,
    });

    await db.admin.query(`update public.users set sharing_paused = true where id = $1`, [cara]);
    expect(await codeOf(ping('user_alice', cara, { confirmed: true }))).toBe(
      DB_ERROR.pingRecipientUnavailable,
    );
    expect(await pingCount()).toBe(0);
  });

  it('says which status blocked it in the error detail', async () => {
    await setOverride(bob, 'dnd');
    const detail = await db
      .asUser('user_alice')
      .query(`select public.send_ping($1, 'Call me', null, true)`, [bob])
      .then(
        () => null,
        (e: { detail?: string }) => e.detail,
      );
    expect(detail).toBe('dnd');
  });

  it.each(['busy', 'focused', 'away'])(
    'a manual %s status needs a confirmation first',
    async (status) => {
      await setOverride(bob, status);
      expect(await errorOf(ping('user_alice', bob))).toEqual({
        code: DB_ERROR.pingNeedsConfirmation,
        message: PING_ERRORS.needsConfirmation,
      });
      expect(await pingCount()).toBe(0);
      expect((await ping('user_alice', bob, { confirmed: true })).recipient_id).toBe(bob);
    },
  );

  it('someone with no schedule needs a confirmation too', async () => {
    await db.admin.query(`delete from public.status_overrides where user_id = $1`, [bob]);
    expect(await codeOf(ping('user_alice', bob))).toBe(DB_ERROR.pingNeedsConfirmation);
    expect(await codeOf(ping('user_alice', bob, { confirmed: true }))).toBe('ok');
  });

  it('free goes straight through', async () => {
    expect(await codeOf(ping('user_alice', bob, { confirmed: false }))).toBe('ok');
  });
});

describe('private.ping_status (the server-side FR-PING-1 check)', () => {
  // Monday 5 October 2026, 15:00 UTC = 10:00 in America/Jamaica (UTC-5, no DST).
  const MON_10AM_JA = '2026-10-05T15:00:00Z';

  async function statusAt(userId: string, at: string): Promise<string | null> {
    const { rows } = await db.admin.query<{ s: string | null }>(
      `select private.ping_status($1, $2) as s`,
      [userId, at],
    );
    return rows[0]?.s ?? null;
  }

  beforeEach(async () => {
    await db.admin.query(`delete from public.status_overrides`);
  });

  it('follows the engine’s precedence: paused, manual status, no schedule, events, hours', async () => {
    expect(await statusAt(bob, MON_10AM_JA)).toBe('no_schedule');
    const source = await addSource(db, bob);
    expect(await statusAt(bob, MON_10AM_JA)).toBe('free');

    await addEvent(db, bob, source, {
      startsAt: '2026-10-05T14:30:00Z',
      endsAt: '2026-10-05T15:30:00Z',
    });
    expect(await statusAt(bob, MON_10AM_JA)).toBe('busy');
    // Ends are exclusive.
    expect(await statusAt(bob, '2026-10-05T15:30:00Z')).toBe('free');

    await db.admin.query(
      `insert into public.status_overrides (user_id, status, starts_at)
       values ($1, 'dnd', '2026-10-05T14:00:00Z')`,
      [bob],
    );
    expect(await statusAt(bob, MON_10AM_JA)).toBe('dnd');

    await db.admin.query(`update public.users set sharing_paused = true where id = $1`, [bob]);
    expect(await statusAt(bob, MON_10AM_JA)).toBe('paused');
  });

  it('the latest-starting manual status wins; focused counts as busy', async () => {
    await db.admin.query(
      `insert into public.status_overrides (user_id, status, starts_at, ends_at) values
         ($1, 'dnd', '2026-10-05T14:00:00Z', '2026-10-05T14:30:00Z'),
         ($1, 'focused', '2026-10-05T14:30:00Z', '2026-10-05T16:00:00Z')`,
      [bob],
    );
    expect(await statusAt(bob, '2026-10-05T14:10:00Z')).toBe('dnd');
    expect(await statusAt(bob, MON_10AM_JA)).toBe('busy');
  });

  it('away outside available hours, read in the user’s timezone', async () => {
    await addSource(db, bob);
    // Default hours 08:00-22:00, America/Jamaica.
    expect(await statusAt(bob, '2026-10-05T12:59:00Z')).toBe('away'); // 07:59
    expect(await statusAt(bob, '2026-10-05T13:00:00Z')).toBe('free'); // 08:00
    expect(await statusAt(bob, '2026-10-06T02:59:00Z')).toBe('free'); // Mon 21:59
    expect(await statusAt(bob, '2026-10-06T03:00:00Z')).toBe('away'); // Mon 22:00

    await db.admin.query(
      `update public.availability_prefs
       set weekly = '[{"day": "tue", "start": "09:00", "end": "17:00"}]'
       where user_id = $1`,
      [bob],
    );
    expect(await statusAt(bob, MON_10AM_JA)).toBe('away'); // no Monday window
    expect(await statusAt(bob, '2026-10-06T15:00:00Z')).toBe('free'); // Tue 10:00

    await db.admin.query(`update public.users set timezone = 'Asia/Tokyo' where id = $1`, [bob]);
    // Tue 6 Oct 00:00 UTC = Tue 09:00 in Tokyo.
    expect(await statusAt(bob, '2026-10-06T00:00:00Z')).toBe('free');
  });

  it('an offline friend’s schedule is not the user’s own (D44)', async () => {
    const { rows } = await db.admin.query<{ id: string }>(
      `insert into public.offline_friends (user_id, nickname, permission_confirmed_at)
       values ($1, 'Tash', now()) returning id`,
      [bob],
    );
    const tash = rows[0]?.id as string;
    const source = await addSource(db, bob, { offlineFriendId: tash });
    await addEvent(db, bob, source, {
      startsAt: '2026-10-05T14:30:00Z',
      endsAt: '2026-10-05T15:30:00Z',
      offlineFriendId: tash,
    });
    expect(await statusAt(bob, MON_10AM_JA)).toBe('no_schedule');
  });

  it('APPROXIMATE: recurring events are not expanded (the UI asks for confirmation from the engine)', async () => {
    const source = await addSource(db, bob);
    await addEvent(db, bob, source, {
      startsAt: '2026-09-28T14:30:00Z',
      endsAt: '2026-09-28T15:30:00Z',
      rrule: 'FREQ=WEEKLY;BYDAY=MO',
    });
    expect(await statusAt(bob, MON_10AM_JA)).toBe('free');
  });

  it('null for a missing user', async () => {
    expect(await statusAt(crypto.randomUUID(), MON_10AM_JA)).toBeNull();
  });
});

describe('send_ping: content (D14, D31)', () => {
  it('accepts every template in PING_TEMPLATES, text alone, or both', async () => {
    for (const template of PING_TEMPLATES) await ping('user_alice', bob, { template });
    await ping('user_alice', bob, { template: null, message: 'Patty run?' });
    await ping('user_alice', bob, { template: 'Link up?', message: 'By the gate' });
    expect(await pingCount()).toBe(PING_TEMPLATES.length + 2);
  });

  it('rejects an unknown template, and a ping with neither template nor text', async () => {
    expect(await errorOf(ping('user_alice', bob, { template: 'Wanna fight?' }))).toEqual({
      code: '22023',
      message: PING_ERRORS.unknownTemplate,
    });
    for (const message of [null, '', '   \n '])
      expect(await errorOf(ping('user_alice', bob, { template: null, message }))).toEqual({
        code: '22023',
        message: PING_ERRORS.emptyPing,
      });
  });

  it('text: trimmed, at most 140 characters (an emoji counts as one), CRLF becomes LF', async () => {
    const { ping_id } = await ping('user_alice', bob, { message: '  Patty run?\r\nGate  ' });
    const { rows } = await db.admin.query<{ text: string }>(
      `select text from public.pings where id = $1`,
      [ping_id],
    );
    expect(rows[0]?.text).toBe('Patty run?\nGate');
    expect(await codeOf(ping('user_alice', bob, { message: '🍗'.repeat(140) }))).toBe('ok');
    expect(await errorOf(ping('user_alice', bob, { message: 'a'.repeat(141) }))).toEqual({
      code: '22023',
      message: PING_ERRORS.invalidText,
    });
  });

  it('text: no control characters other than tab and newline; the error never repeats it', async () => {
    expect(await codeOf(ping('user_alice', bob, { message: 'a\tb\nc' }))).toBe('ok');
    for (const c of ['\u0007', '\r', '\u001b', '\u007f']) {
      const error = await errorOf(ping('user_alice', bob, { message: `${SECRET}${c}!` }));
      expect(error).toEqual({ code: '22023', message: PING_ERRORS.invalidText });
      expect(JSON.stringify(error)).not.toContain(SECRET);
    }
  });
});

describe('send_ping: rate limit (NFR-SEC-9, FR-PING-6)', () => {
  it(`allows ${PING_DAILY_LIMIT} a day per sender`, async () => {
    await setRateCount(db, alice, 'ping', PING_DAILY_LIMIT - 1);
    await ping('user_alice', bob);
    expect(await codeOf(ping('user_alice', cara))).toBe(DB_ERROR.rateLimited);
    // Other senders are unaffected.
    expect(await codeOf(ping('user_bob', alice))).toBe('ok');
  });

  it('a refused ping does not use up the allowance', async () => {
    await setOverride(bob, 'dnd');
    for (let i = 0; i < 3; i++) await codeOf(ping('user_alice', bob));
    const { rows } = await db.admin.query(
      `select count from public.rate_limits where user_id = $1 and action = 'ping'`,
      [alice],
    );
    expect(rows).toEqual([]);
  });
});

describe('RLS: only the sender and recipient can read a ping; nobody writes directly', () => {
  it('both parties can select it, nobody else can', async () => {
    const { ping_id } = await ping('user_alice', bob, { message: SECRET });
    const select = `select id, text from public.pings`;
    expect(await db.asUser('user_alice').query(select)).toEqual([{ id: ping_id, text: SECRET }]);
    expect(await db.asUser('user_bob').query(select)).toEqual([{ id: ping_id, text: SECRET }]);
    for (const other of ['user_cara', 'user_dan', 'user_fay'])
      expect(await db.asUser(other).query(select)).toEqual([]);
    expect(await codeOf(db.asAnon().query(select))).toBe('42501');
  });

  it('read flags are not selectable (no read receipts)', async () => {
    await ping('user_alice', bob);
    for (const col of ['read_at', 'reply_read_at', '*'])
      expect(await codeOf(db.asUser('user_alice').query(`select ${col} from public.pings`))).toBe(
        '42501',
      );
  });

  it('no direct insert, update or delete, even of your own pings', async () => {
    const { ping_id } = await ping('user_alice', bob);
    const asBob = db.asUser('user_bob');
    expect(
      await codeOf(
        asBob.query(
          `insert into public.pings (sender_id, recipient_id, template, expires_at)
           values ($1, $2, 'Call me', now() + interval '2 hours')`,
          [bob, alice],
        ),
      ),
    ).toBe('42501');
    expect(
      await codeOf(asBob.query(`update public.pings set reply = 'In 10' where id = $1`, [ping_id])),
    ).toBe('42501');
    expect(
      await codeOf(
        db.asUser('user_alice').query(`delete from public.pings where id = $1`, [ping_id]),
      ),
    ).toBe('42501');
  });

  it('the blocker no longer sees pings with the person they blocked', async () => {
    await ping('user_alice', bob);
    await block(db, bob, alice);
    expect(await db.asUser('user_bob').query(`select id from public.pings`)).toEqual([]);
  });
});

describe('list_inbox and unread_ping_count (FR-PING-3)', () => {
  it('received and sent, newest first, with the other person’s public profile', async () => {
    const first = await ping('user_alice', bob, { message: 'first' });
    await db.admin.query(
      `update public.pings set created_at = created_at - interval '5 minutes',
         expires_at = expires_at - interval '5 minutes' where id = $1`,
      [first.ping_id],
    );
    const second = await ping('user_bob', alice, { template: 'Wanna study?' });

    const rows = await inbox('user_alice');
    expect(rows.map((r) => [r.id, r.direction, r.other_id, r.other_name, r.unread])).toEqual([
      [second.ping_id, 'received', bob, 'Name of user_bob', true],
      [first.ping_id, 'sent', bob, 'Name of user_bob', false],
    ]);
    expect(rows[1]).toMatchObject({ template: 'Free for food?', text: 'first', reply: null });
    expect(Object.keys(rows[0] ?? {}).sort()).toEqual(
      [
        'id',
        'direction',
        'other_id',
        'other_name',
        'other_handle',
        'other_avatar_url',
        'template',
        'text',
        'reply',
        'reply_text',
        'replied_at',
        'created_at',
        'expires_at',
        'unread',
      ].sort(),
    );
    expect(await unread('user_alice')).toBe(1);
    expect(await unread('user_bob')).toBe(1);
  });

  it('shows nobody else’s pings', async () => {
    await ping('user_alice', bob);
    expect(await inbox('user_cara')).toEqual([]);
    expect(await unread('user_cara')).toBe(0);
    expect(await inbox('user_nobody')).toEqual([]);
    expect(await unread('user_nobody')).toBe(0);
  });

  it('leaves out anyone blocked, in either direction', async () => {
    await ping('user_alice', bob);
    await ping('user_cara', alice);
    await block(db, bob, alice);
    await block(db, alice, cara);
    for (const clerk of ['user_alice', 'user_bob', 'user_cara']) {
      expect(await inbox(clerk)).toEqual([]);
      expect(await unread(clerk)).toBe(0);
    }
  });

  it('leaves out pings older than 30 days (D32)', async () => {
    const { ping_id } = await ping('user_alice', bob);
    await db.admin.query(
      `update public.pings set created_at = now() - interval '31 days',
         expires_at = now() - interval '31 days' + interval '2 hours' where id = $1`,
      [ping_id],
    );
    expect(await inbox('user_bob')).toEqual([]);
    expect(await unread('user_bob')).toBe(0);
  });
});

describe('mark_pings_read', () => {
  it('marks the caller’s received pings read: the given ones, or all', async () => {
    const a = await ping('user_alice', bob);
    const b = await ping('user_cara', alice);
    const c = await ping('user_alice', bob, { template: 'Call me' });
    const mark = (clerk: string, ids: string[] | null) =>
      db
        .asUser(clerk)
        .query<{ n: number }>(`select public.mark_pings_read($1) as n`, [ids])
        .then((r) => r[0]?.n);

    // Not the recipient: nothing changes.
    expect(await mark('user_alice', [a.ping_id])).toBe(0);
    expect(await mark('user_cara', [a.ping_id, c.ping_id])).toBe(0);
    expect(await mark('user_bob', [a.ping_id])).toBe(1);
    expect(await mark('user_bob', [a.ping_id])).toBe(0);
    expect((await inbox('user_bob')).map((r) => [r.id, r.unread])).toEqual([
      [c.ping_id, true],
      [a.ping_id, false],
    ]);
    expect(await mark('user_bob', null)).toBe(1);
    expect(await unread('user_bob')).toBe(0);
    expect(await unread('user_alice')).toBe(1);
    expect(b.recipient_id).toBe(alice);
  });

  it('marks replies to the caller’s sent pings read', async () => {
    const { ping_id } = await ping('user_alice', bob);
    await reply('user_bob', ping_id);
    expect(await unread('user_alice')).toBe(1);
    expect((await inbox('user_alice'))[0]?.unread).toBe(true);
    await db
      .asUser('user_alice')
      .query(`select public.mark_pings_read(array[$1]::uuid[])`, [ping_id]);
    expect(await unread('user_alice')).toBe(0);
  });
});

describe('reply_to_ping (WF-093, FR-PING-4)', () => {
  it('the recipient replies in one tap; the sender sees it and is returned for notifying', async () => {
    const { ping_id } = await ping('user_alice', bob);
    expect(await reply('user_bob', ping_id, { reply: 'In 10' })).toEqual({
      sender_id: alice,
      replier_name: 'Name of user_bob',
      notify: true,
    });
    const [row] = await inbox('user_alice');
    expect(row).toMatchObject({
      id: ping_id,
      direction: 'sent',
      reply: 'In 10',
      reply_text: null,
      unread: true,
    });
    expect(row?.replied_at).toBeInstanceOf(Date);
  });

  it('accepts every reply in PING_REPLIES, or short text', async () => {
    for (const r of PING_REPLIES) {
      const { ping_id } = await ping('user_alice', bob);
      expect(await codeOf(reply('user_bob', ping_id, { reply: r }))).toBe('ok');
    }
    const { ping_id } = await ping('user_alice', bob);
    await reply('user_bob', ping_id, { reply: null, message: '  Give me 5 mins ' });
    expect((await inbox('user_alice'))[0]).toMatchObject({
      reply: null,
      reply_text: 'Give me 5 mins',
    });
  });

  it('exactly one of a quick reply and a message, each valid', async () => {
    const { ping_id } = await ping('user_alice', bob);
    expect(await errorOf(reply('user_bob', ping_id, { reply: null }))).toEqual({
      code: '22023',
      message: PING_ERRORS.replyNeedsOne,
    });
    expect(await errorOf(reply('user_bob', ping_id, { reply: 'In 10', message: 'ok' }))).toEqual({
      code: '22023',
      message: PING_ERRORS.replyNeedsOne,
    });
    expect(await errorOf(reply('user_bob', ping_id, { reply: 'Never' }))).toEqual({
      code: '22023',
      message: PING_ERRORS.unknownReply,
    });
    expect(
      await errorOf(reply('user_bob', ping_id, { reply: null, message: 'a'.repeat(141) })),
    ).toEqual({ code: '22023', message: PING_ERRORS.invalidText });
  });

  it('only the recipient can reply: the sender and anyone else get "Ping not found"', async () => {
    const { ping_id } = await ping('user_alice', bob);
    const notFound = { code: DB_ERROR.pingNotFound, message: PING_ERRORS.pingNotFound };
    expect(await errorOf(reply('user_alice', ping_id))).toEqual(notFound);
    expect(await errorOf(reply('user_cara', ping_id))).toEqual(notFound);
    expect(await errorOf(reply('user_bob', crypto.randomUUID()))).toEqual(notFound);
  });

  it('a reply is final', async () => {
    const { ping_id } = await ping('user_alice', bob);
    await reply('user_bob', ping_id);
    expect(await errorOf(reply('user_bob', ping_id, { reply: 'In 10' }))).toEqual({
      code: DB_ERROR.pingAlreadyReplied,
      message: PING_ERRORS.alreadyReplied,
    });
  });

  it('works after an unfriend, but not across a block (either way), which looks like not found', async () => {
    const one = await ping('user_alice', bob);
    const two = await ping('user_alice', bob);
    await db.admin.query(`delete from public.friendships`);
    expect(await codeOf(reply('user_bob', one.ping_id))).toBe('ok');
    await block(db, alice, bob);
    expect(await codeOf(reply('user_bob', two.ping_id))).toBe(DB_ERROR.pingNotFound);
    await db.admin.query(`delete from public.blocks`);
    await block(db, bob, alice);
    expect(await codeOf(reply('user_bob', two.ping_id))).toBe(DB_ERROR.pingNotFound);
  });
});

describe('Realtime: inbox_changed carries nothing (D41, NFR-SEC-11)', () => {
  interface Message {
    topic: string;
    event: string;
    payload: unknown;
    private: boolean;
  }
  const messages = async () =>
    (
      await db.admin.query<Message>(
        `select topic, event, payload, private from realtime.messages
         where event = $1 order by topic`,
        [INBOX_CHANGED_EVENT],
      )
    ).rows;

  it('a ping signals the recipient and the sender, with an empty payload', async () => {
    const { ping_id } = await ping('user_alice', bob, { message: SECRET });
    const sent = await messages();
    expect(sent.map((m) => m.topic).sort()).toEqual([userChannel(alice), userChannel(bob)].sort());
    for (const m of sent) expect(m).toMatchObject({ payload: {}, private: true });
    const all = JSON.stringify((await db.admin.query(`select * from realtime.messages`)).rows);
    for (const leak of [SECRET, 'Free for food?', ping_id, 'Name of'])
      expect(all).not.toContain(leak);
  });

  it('a reply signals both people', async () => {
    const { ping_id } = await ping('user_alice', bob);
    await db.admin.query(`delete from realtime.messages`);
    await reply('user_bob', ping_id, { reply: null, message: SECRET });
    const sent = await messages();
    expect(sent.map((m) => m.topic).sort()).toEqual([userChannel(alice), userChannel(bob)].sort());
    expect(JSON.stringify(sent)).not.toContain(SECRET);
  });

  it('a refused ping signals nobody', async () => {
    await setOverride(bob, 'dnd');
    await db.admin.query(`delete from realtime.messages`);
    await codeOf(ping('user_alice', bob));
    await codeOf(ping('user_alice', dan));
    expect(await messages()).toEqual([]);
  });
});

describe('private.purge_old_pings (D32)', () => {
  it('deletes pings older than 30 days', async () => {
    const old = await ping('user_alice', bob);
    await ping('user_alice', bob);
    await db.admin.query(
      `update public.pings set created_at = now() - interval '31 days',
         expires_at = now() - interval '31 days' + interval '2 hours' where id = $1`,
      [old.ping_id],
    );
    const { rows } = await db.admin.query<{ n: number }>(`select private.purge_old_pings() as n`);
    expect(rows[0]?.n).toBe(1);
    expect(await pingCount()).toBe(1);
  });
});
