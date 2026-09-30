// WF-064: now_for_viewer, the Now screen's data. Every connection comes back
// already redacted to the viewer's tier, in the shape @whosfree/availability
// takes (PRD §8.5, FR-VIEW-1, FR-VIEW-2, FR-VIS-3, FR-VIS-4, FR-VIS-5,
// FR-VIS-6, FR-SOC-6, D22, D35, D41, D44).

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { statusAt } from '@whosfree/availability';
import type { AvailabilityInput } from '@whosfree/availability';
import { AvailableHours } from '@whosfree/shared';
import type { NowConnection } from '../src/index';
import { createTestDb } from './harness/db';
import type { TestDb } from './harness/db';
import { codeOf } from './harness/errors';
import { addEvent, addGroup, addSource, addUser, befriend, block, setRule } from './harness/seed';

// Monday 5 October 2026, 00:00 to 24:00 UTC.
const RANGE = ['2026-10-05T00:00:00Z', '2026-10-06T00:00:00Z'] as const;
const LECTURE = { title: 'COMP2140 Lecture', category: 'class' };
const SECRET_EVENT = { title: 'Therapy at the clinic', category: 'meeting' };
const LABEL = 'Revising for MATH1141';
const SECRETS = [LECTURE.title, SECRET_EVENT.title, LABEL, 'Reading week'];
const ms = (iso: string) => Date.parse(iso);

let db: TestDb;
let viewer: string;

beforeAll(async () => {
  db = await createTestDb();
});
afterAll(() => db.close());

beforeEach(async () => {
  await db.reset();
  viewer = await addUser(db, 'user_viewer');
});

/** now_for_viewer as `clerkId` over RANGE (or the given range), rows keyed by user id. */
async function now(
  clerkId: string,
  range: readonly [string, string] = RANGE,
): Promise<Map<string, NowConnection>> {
  const rows = await db
    .asUser(clerkId)
    .query<NowConnection & Record<string, unknown>>(`select * from public.now_for_viewer($1, $2)`, [
      ...range,
    ]);
  return new Map(rows.map((r) => [r.user_id, r]));
}

async function rowFor(ownerId: string, clerkId = 'user_viewer'): Promise<NowConnection> {
  const row = (await now(clerkId)).get(ownerId);
  if (row === undefined) throw new Error(`no row for ${ownerId}`);
  return row;
}

/**
 * A user with one upload source (with a period whose break has a label), a titled lecture
 * 14:00-16:00, a private event 18:00-19:00, a non-busy event and a manual status with a label.
 */
async function addOwner(clerkId: string): Promise<{ id: string; lectureId: string }> {
  const id = await addUser(db, clerkId);
  await db.admin.query(`update public.users set timezone = 'America/New_York' where id = $1`, [id]);
  const source = await addSource(db, id, { periodStart: '2026-09-01', periodEnd: '2026-12-18' });
  await db.admin.query(
    `update public.sources set period_exceptions =
       '[{"start": "2026-10-19", "end": "2026-10-23", "label": "Reading week"}]' where id = $1`,
    [source],
  );
  const lectureId = await addEvent(db, id, source, {
    ...LECTURE,
    startsAt: '2026-10-05T14:00:00Z',
    endsAt: '2026-10-05T16:00:00Z',
  });
  await addEvent(db, id, source, {
    ...SECRET_EVENT,
    isPrivate: true,
    startsAt: '2026-10-05T18:00:00Z',
    endsAt: '2026-10-05T19:00:00Z',
  });
  await addEvent(db, id, source, {
    title: 'Lunch (free)',
    busy: false,
    startsAt: '2026-10-05T12:00:00Z',
    endsAt: '2026-10-05T13:00:00Z',
  });
  await db.admin.query(
    `insert into public.status_overrides (user_id, status, label, starts_at, ends_at)
     values ($1, 'focused', $2, '2026-10-05T20:00:00Z', '2026-10-05T21:00:00Z')`,
    [id, LABEL],
  );
  return { id, lectureId };
}

/** Every object key in a value, recursively. */
function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysOf);
  if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
    return Object.entries(value).flatMap(([k, v]) => [k, ...keysOf(v)]);
  }
  return [];
}

describe('who is on the Now screen', () => {
  it('friends and group co-members, once each, never the viewer, pending requests or friends of friends', async () => {
    const friend = await addUser(db, 'user_friend');
    const member = await addUser(db, 'user_member');
    const both = await addUser(db, 'user_both');
    const friendOfFriend = await addUser(db, 'user_fof');
    const pending = await addUser(db, 'user_pending');
    const stranger = await addUser(db, 'user_stranger');
    await befriend(db, viewer, friend);
    await befriend(db, viewer, both);
    await befriend(db, friend, friendOfFriend);
    await befriend(db, pending, viewer, 'pending');
    const netball = await addGroup(db, viewer, [member, both], 'Netball');
    const chess = await addGroup(db, both, [viewer], 'Chess');
    // A group the viewer isn't in: sharing it with a friend of a friend grants nothing.
    await addGroup(db, friend, [friendOfFriend], 'Other');

    const rows = await now('user_viewer');
    expect([...rows.keys()].sort()).toEqual([friend, member, both].sort());
    expect(rows.has(viewer)).toBe(false);
    for (const absent of [friendOfFriend, pending, stranger]) expect(rows.has(absent)).toBe(false);

    expect(rows.get(friend)).toMatchObject({ relationship: 'friend', group_ids: [] });
    expect(rows.get(member)).toMatchObject({ relationship: 'none', group_ids: [netball] });
    expect(rows.get(both)?.relationship).toBe('friend');
    expect(rows.get(both)?.group_ids).toEqual([netball, chess].sort());
  });

  it('returns the public profile, ordered by name', async () => {
    const zed = await addUser(db, 'user_zed', {
      handle: 'zed',
      avatarUrl: 'https://img.example/zed.png',
    });
    const amy = await addUser(db, 'user_amy');
    await db.admin.query(`update public.users set name = 'Zed' where id = $1`, [zed]);
    await db.admin.query(`update public.users set name = 'Amy' where id = $1`, [amy]);
    await befriend(db, viewer, zed);
    await befriend(db, viewer, amy);

    const rows = await db
      .asUser('user_viewer')
      .query<NowConnection & Record<string, unknown>>(`select * from public.now_for_viewer()`);
    expect(rows.map((r) => r.name)).toEqual(['Amy', 'Zed']);
    expect(rows[1]).toMatchObject({
      user_id: zed,
      handle: 'zed',
      avatar_url: 'https://img.example/zed.png',
    });
  });

  it('leaves out anyone blocked in either direction, even if still a friend or co-member', async () => {
    const blockedFriend = await addUser(db, 'user_blocked_friend');
    const blockerMember = await addUser(db, 'user_blocker_member');
    const ok = await addUser(db, 'user_ok');
    await befriend(db, viewer, blockedFriend);
    await addGroup(db, viewer, [blockerMember, ok]);
    await block(db, viewer, blockedFriend);
    await block(db, blockerMember, viewer);

    expect([...(await now('user_viewer')).keys()]).toEqual([ok]);
    expect((await now('user_blocked_friend')).has(viewer)).toBe(false);
    expect((await now('user_blocker_member')).has(viewer)).toBe(false);
  });

  it('unauthenticated calls get nothing', async () => {
    const friend = await addUser(db, 'user_friend');
    await befriend(db, viewer, friend);
    // No token at all: anon can't execute it.
    expect(await codeOf(db.asAnon().query(`select * from public.now_for_viewer()`))).toBe('42501');
    // A token with no users row (sign-up not finished): no rows.
    expect((await now('user_unknown')).size).toBe(0);
    // The service role has no grant either: the server calls it as the user.
    expect(await codeOf(db.asService().query(`select * from public.now_for_viewer()`))).toBe(
      '42501',
    );
  });
});

describe('tier redaction (FR-VIS-3, FR-VIS-5, D35)', () => {
  it.each([1, 2, 3] as const)('T%i sees exactly its fields, and never a location', async (tier) => {
    const { id } = await addOwner('user_owner');
    await befriend(db, viewer, id);
    await setRule(db, id, 'friend', viewer, tier);

    const row = await rowFor(id);
    expect(row.tier).toBe(tier);
    expect(row.paused).toBe(false);
    expect(row.has_schedule).toBe(true);

    const [source] = row.sources;
    expect(row.sources).toHaveLength(1);
    // The period is there (for recurring events), without the break's label.
    expect(source?.period).toEqual({
      start: '2026-09-01',
      end: '2026-12-18',
      exceptions: [{ start: '2026-10-19', end: '2026-10-23' }],
    });
    // Busy events only (no "Lunch (free)"), as epoch ms.
    const events = source?.events ?? [];
    expect(events.map((e) => [e.start, e.end])).toEqual([
      [ms('2026-10-05T14:00:00Z'), ms('2026-10-05T16:00:00Z')],
      [ms('2026-10-05T18:00:00Z'), ms('2026-10-05T19:00:00Z')],
    ]);
    const [lecture, privateEvent] = events;
    expect(lecture?.category).toBe(tier >= 2 ? LECTURE.category : null);
    expect(lecture?.title).toBe(tier >= 3 ? LECTURE.title : null);
    // FR-VIS-4: a private event is plain busy at every tier.
    expect(privateEvent).toMatchObject({ category: null, title: null });

    // The override: label only at T3; `focused` is a reason, so below T2 it's plain busy.
    expect(row.overrides).toEqual([
      {
        id: expect.any(String),
        status: tier >= 2 ? 'focused' : 'busy',
        label: tier >= 3 ? LABEL : null,
        startsAt: ms('2026-10-05T20:00:00Z'),
        endsAt: ms('2026-10-05T21:00:00Z'),
      },
    ]);

    // Nothing above the tier anywhere in the row.
    const text = JSON.stringify(row);
    const allowed = tier >= 3 ? [LECTURE.title, LABEL] : [];
    for (const secret of SECRETS) {
      expect({ secret, present: text.includes(secret) }).toEqual({
        secret,
        present: allowed.includes(secret),
      });
    }

    // Exactly these keys, at every level: no location, room or anything else (D35).
    expect(Object.keys(row).sort()).toEqual(
      [
        'available_hours',
        'avatar_url',
        'group_ids',
        'handle',
        'has_schedule',
        'name',
        'overrides',
        'paused',
        'relationship',
        'sources',
        'tier',
        'timezone',
        'user_id',
      ].sort(),
    );
    expect(Object.keys(source ?? {}).sort()).toEqual(['events', 'period']);
    expect(Object.keys(lecture ?? {}).sort()).toEqual(
      ['category', 'end', 'exdates', 'id', 'rrule', 'start', 'title'].sort(),
    );
    expect(
      keysOf(row).filter((k) => /location|room|address|place|venue|geo|^(lat|lng|lon)/i.test(k)),
    ).toEqual([]);
  });

  it('the tier is the one resolve_tier gives: a friend rule wins, else the most restrictive group', async () => {
    const { id } = await addOwner('user_owner');
    const g1 = await addGroup(db, id, [viewer], 'A');
    const g2 = await addGroup(db, id, [viewer], 'B');
    await setRule(db, id, 'group', g1, 3);
    await setRule(db, id, 'group', g2, 2);
    expect((await rowFor(id)).tier).toBe(2);
    await befriend(db, viewer, id);
    await setRule(db, id, 'friend', viewer, 3);
    expect((await rowFor(id)).tier).toBe(3);
  });

  it('only events, overrides and hours of the connection are returned (not the viewer’s own)', async () => {
    const { id } = await addOwner('user_owner');
    await befriend(db, viewer, id);
    const mine = await addSource(db, viewer);
    await addEvent(db, viewer, mine, {
      title: 'My own thing',
      startsAt: '2026-10-05T09:00:00Z',
      endsAt: '2026-10-05T10:00:00Z',
    });
    const row = await rowFor(id);
    expect(JSON.stringify(row)).not.toContain('My own thing');
    expect(row.sources.flatMap((s) => s.events)).toHaveLength(2);
  });
});

describe('schedule state', () => {
  it('a paused user comes back with paused set and nothing else (FR-VIS-6)', async () => {
    const { id } = await addOwner('user_owner');
    await befriend(db, viewer, id);
    await setRule(db, id, 'friend', viewer, 3);
    await db.admin.query(`update public.users set sharing_paused = true where id = $1`, [id]);

    const row = await rowFor(id);
    expect(row).toMatchObject({
      user_id: id,
      tier: 3,
      paused: true,
      has_schedule: false,
      timezone: null,
      available_hours: null,
      overrides: [],
      sources: [],
    });
    for (const secret of SECRETS) expect(JSON.stringify(row)).not.toContain(secret);
  });

  it('has_schedule is false with no source ("Not sharing yet", D22) and true with an empty source', async () => {
    const newcomer = await addUser(db, 'user_new');
    await befriend(db, viewer, newcomer);
    expect(await rowFor(newcomer)).toMatchObject({ has_schedule: false, sources: [] });

    await addSource(db, newcomer, { type: 'gcal' });
    expect(await rowFor(newcomer)).toMatchObject({
      has_schedule: true,
      sources: [{ period: null, events: [] }],
    });
  });

  it('passes on only well-formed period exceptions (the owner writes them unchecked)', async () => {
    const owner = await addUser(db, 'user_owner');
    await befriend(db, viewer, owner);
    const source = await addSource(db, owner, {
      periodStart: '2026-09-01',
      periodEnd: '2026-12-18',
    });
    await db.admin.query(`update public.sources set period_exceptions = $2::jsonb where id = $1`, [
      source,
      JSON.stringify([
        { start: '2026-10-19', end: '2026-10-23' },
        { start: 'Secret note', end: '2026-10-23' },
        { start: { nested: true }, end: '2026-10-23' },
        'just a string',
      ]),
    ]);
    expect((await rowFor(owner)).sources[0]?.period?.exceptions).toEqual([
      { start: '2026-10-19', end: '2026-10-23' },
    ]);
  });

  it('returns the timezone and available hours (FR-AVL-2)', async () => {
    const { id } = await addOwner('user_owner');
    await befriend(db, viewer, id);
    await db.asUser('user_owner').query(`select public.set_day_hours('mon', '10:00', '14:00')`);
    const row = await rowFor(id);
    expect(row.timezone).toBe('America/New_York');
    expect(AvailableHours.array().parse(row.available_hours)).toContainEqual({
      day: 'mon',
      start: '10:00',
      end: '14:00',
    });
    expect(row.available_hours).toHaveLength(7);
  });

  it('returns events and overrides in the range only, and recurring series that reach it', async () => {
    const owner = await addUser(db, 'user_owner');
    await befriend(db, viewer, owner);
    const source = await addSource(db, owner);
    await addEvent(db, owner, source, {
      startsAt: '2026-10-04T14:00:00Z',
      endsAt: '2026-10-04T15:00:00Z',
    });
    await addEvent(db, owner, source, {
      startsAt: '2026-10-07T14:00:00Z',
      endsAt: '2026-10-07T15:00:00Z',
    });
    const weekly = await addEvent(db, owner, source, {
      startsAt: '2026-09-07T13:00:00Z',
      endsAt: '2026-09-07T14:00:00Z',
      rrule: 'FREQ=WEEKLY;BYDAY=MO',
      exdates: ['2026-09-14T13:00:00Z'],
    });
    await db.admin.query(
      `insert into public.status_overrides (user_id, status, starts_at, ends_at)
       values ($1, 'dnd', '2026-10-01T00:00:00Z', '2026-10-02T00:00:00Z'),
              ($1, 'away', '2026-10-04T00:00:00Z', null)`,
      [owner],
    );

    const row = await rowFor(owner);
    expect(row.sources[0]?.events).toEqual([
      {
        id: weekly,
        start: ms('2026-09-07T13:00:00Z'),
        end: ms('2026-09-07T14:00:00Z'),
        rrule: 'FREQ=WEEKLY;BYDAY=MO',
        exdates: [ms('2026-09-14T13:00:00Z')],
        category: null,
        title: null,
      },
    ]);
    expect(row.overrides.map((o) => [o.status, o.endsAt])).toEqual([['away', null]]);
  });

  it('checks the range: end after start, at most 8 days, end defaults to start + 7 days', async () => {
    const friend = await addUser(db, 'user_friend');
    await befriend(db, viewer, friend);
    const call = (start: string, end: string | null) =>
      db.asUser('user_viewer').query(`select * from public.now_for_viewer($1, $2)`, [start, end]);
    expect(await codeOf(call(RANGE[1], RANGE[0]))).toBe('22023');
    expect(await codeOf(call(RANGE[0], RANGE[0]))).toBe('22023');
    expect(await codeOf(call(RANGE[0], '2026-10-13T00:00:01Z'))).toBe('22023');
    expect(await codeOf(call(RANGE[0], '2026-10-13T00:00:00Z'))).toBe('ok');

    // An event 6 days out is in the default 7-day window, one 8 days out isn't.
    const source = await addSource(db, friend);
    await addEvent(db, friend, source, {
      startsAt: '2026-10-11T12:00:00Z',
      endsAt: '2026-10-11T13:00:00Z',
    });
    await addEvent(db, friend, source, {
      startsAt: '2026-10-13T12:00:00Z',
      endsAt: '2026-10-13T13:00:00Z',
    });
    const [row] = await db
      .asUser('user_viewer')
      .query<NowConnection & Record<string, unknown>>(`select * from public.now_for_viewer($1)`, [
        RANGE[0],
      ]);
    expect(row?.sources[0]?.events.map((e) => e.start)).toEqual([ms('2026-10-11T12:00:00Z')]);
  });
});

describe('feeding @whosfree/availability', () => {
  /** What the server passes to statusAt for one row. */
  function engineInput(row: NowConnection): AvailabilityInput {
    return {
      ...(row.timezone === null ? {} : { timeZone: row.timezone }),
      sharingPaused: row.paused,
      ...(row.available_hours === null
        ? {}
        : { availableHours: AvailableHours.array().parse(row.available_hours) }),
      overrides: row.overrides,
      sources: row.sources,
    };
  }

  it('works out status and "until X" from the row as returned', async () => {
    const { id, lectureId } = await addOwner('user_owner');
    await befriend(db, viewer, id);
    const input = engineInput(await rowFor(id));

    // 10:30 in New York (EDT, UTC-4) is 14:30 UTC: in the lecture until 16:00 UTC.
    expect(statusAt(input, ms('2026-10-05T14:30:00Z'))).toEqual({
      status: 'busy',
      cause: { type: 'events', eventIds: [lectureId] },
      until: ms('2026-10-05T16:00:00Z'),
      nextStatus: 'free',
    });
    // The T1 override: focused shows as busy, cause keeps the redacted status.
    expect(statusAt(input, ms('2026-10-05T20:30:00Z'))).toMatchObject({
      status: 'busy',
      cause: { type: 'override', manualStatus: 'busy' },
      until: ms('2026-10-05T21:00:00Z'),
    });
    // 05:00 UTC is 01:00 in New York: outside the default available hours.
    expect(statusAt(input, ms('2026-10-05T05:00:00Z')).status).toBe('away');
  });

  it('paused and no-schedule connections', async () => {
    const paused = await addUser(db, 'user_paused', { sharingPaused: true });
    const newcomer = await addUser(db, 'user_new');
    await befriend(db, viewer, paused);
    await befriend(db, viewer, newcomer);
    const at = ms('2026-10-05T15:00:00Z');
    expect(statusAt(engineInput(await rowFor(paused)), at).status).toBe('paused');
    expect(statusAt(engineInput(await rowFor(newcomer)), at).status).toBe('no_schedule');
  });
});
