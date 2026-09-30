// WF-063: manual status override (PRD §9 statusOverrides, FR-AVL-3, J5).

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MANUAL_STATUSES } from '@whosfree/shared';
import { createTestDb } from './harness/db';
import type { TestDb } from './harness/db';
import { addUser } from './harness/seed';

type OverrideRow = {
  id: string;
  user_id: string;
  status: string;
  label: string | null;
  starts_at: Date;
  ends_at: Date | null;
};

const HOUR_MS = 3_600_000;

let db: TestDb;
let alice: string;
let bob: string;

beforeAll(async () => {
  db = await createTestDb();
});
afterAll(() => db.close());
beforeEach(async () => {
  await db.reset();
  alice = await addUser(db, 'user_alice');
  bob = await addUser(db, 'user_bob');
});

const setStatus = (
  clerkId: string,
  status: unknown,
  label: unknown = null,
  endsAt: unknown = null,
) =>
  db
    .asUser(clerkId)
    .query<OverrideRow>(`select * from public.set_status($1, $2, $3)`, [status, label, endsAt])
    .then((rows) => rows[0] as OverrideRow);

const inHours = (h: number) => new Date(Date.now() + h * HOUR_MS).toISOString();

async function overridesOf(userId: string): Promise<OverrideRow[]> {
  const { rows } = await db.admin.query<OverrideRow>(
    `select * from public.status_overrides where user_id = $1 order by starts_at`,
    [userId],
  );
  return rows;
}

/** Moves a row's start (and end, if any) back in time, as if it was set earlier. */
async function backdate(id: string, hours: number): Promise<void> {
  await db.admin.query(
    `update public.status_overrides
     set starts_at = starts_at - make_interval(hours => $2),
         ends_at = ends_at - make_interval(hours => $2)
     where id = $1`,
    [id, hours],
  );
}

/** Overrides active at the database's now(). */
async function activeOf(userId: string): Promise<OverrideRow[]> {
  const { rows } = await db.admin.query<OverrideRow>(
    `select * from public.status_overrides
     where user_id = $1 and starts_at <= now() and (ends_at is null or ends_at > now())`,
    [userId],
  );
  return rows;
}

describe('set_status()', () => {
  it('sets an "until I change it" status starting now', async () => {
    const before = Date.now();
    const row = await setStatus('user_alice', 'dnd');
    expect(row).toMatchObject({ user_id: alice, status: 'dnd', label: null, ends_at: null });
    expect(row.starts_at.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(await overridesOf(alice)).toEqual([row]);
  });

  it('sets a status with a label and an end time', async () => {
    const endsAt = inHours(2);
    const row = await setStatus('user_alice', 'focused', '  Revising for MATH1141  ', endsAt);
    expect(row).toMatchObject({
      status: 'focused',
      label: 'Revising for MATH1141',
      ends_at: new Date(endsAt),
    });
  });

  it.each(MANUAL_STATUSES)('accepts %s', async (status) => {
    expect((await setStatus('user_alice', status)).status).toBe(status);
  });

  it.each([['no_schedule'], ['paused'], ['FREE'], [''], [null]])(
    'rejects the status %s',
    async (status) => {
      await expect(setStatus('user_alice', status)).rejects.toThrow(/Unknown status/);
      expect(await overridesOf(alice)).toEqual([]);
    },
  );

  describe('closing the previous status', () => {
    it('closes an open-ended status at the new one’s start, so it never comes back', async () => {
      const old = await setStatus('user_alice', 'dnd');
      await backdate(old.id, 1);
      const current = await setStatus('user_alice', 'focused', null, inHours(1));
      const rows = await overridesOf(alice);
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({ id: old.id, status: 'dnd', ends_at: current.starts_at });
      expect(rows[1]).toEqual(current);
      expect(rows.filter((r) => r.ends_at === null)).toEqual([]);
    });

    it('cuts short a timed status that is still running', async () => {
      const old = await setStatus('user_alice', 'busy', null, inHours(3));
      await backdate(old.id, 1);
      const current = await setStatus('user_alice', 'free');
      const [first] = await overridesOf(alice);
      expect(first?.ends_at).toEqual(current.starts_at);
      expect((await activeOf(alice)).map((r) => r.id)).toEqual([current.id]);
    });

    it('leaves statuses that already ended untouched', async () => {
      const ended = await setStatus('user_alice', 'away', null, inHours(1));
      await backdate(ended.id, 5); // ended 4 hours ago
      const [before] = await overridesOf(alice);
      await setStatus('user_alice', 'busy');
      const [after] = await overridesOf(alice);
      expect(after).toEqual(before);
    });

    it('twice in one transaction keeps only the second', async () => {
      const second = await db.asUser('user_alice').run(async (tx) => {
        await tx.query(`select public.set_status('dnd')`);
        return (await tx.query<OverrideRow>(`select * from public.set_status('away')`)).rows[0];
      });
      expect(await overridesOf(alice)).toEqual([second]);
    });

    it('only ever closes the caller’s own status', async () => {
      const bobs = await setStatus('user_bob', 'dnd');
      await setStatus('user_alice', 'busy');
      expect(await overridesOf(bob)).toEqual([bobs]);
    });

    it('at most one open-ended status per user, even for server-side writes', async () => {
      await setStatus('user_alice', 'dnd');
      await expect(
        db.admin.query(
          `insert into public.status_overrides (user_id, status) values ($1, 'away')`,
          [alice],
        ),
      ).rejects.toThrow(/status_overrides_one_open_key/);
    });
  });

  describe('ends_at limits', () => {
    it('rejects an end time in the past or exactly now', async () => {
      await expect(setStatus('user_alice', 'busy', null, inHours(-1))).rejects.toThrow(
        /ends_at must be in the future/,
      );
      await expect(
        db.asUser('user_alice').query(`select public.set_status('busy', null, now())`),
      ).rejects.toThrow(/ends_at must be in the future/);
      expect(await overridesOf(alice)).toEqual([]);
    });

    it('accepts up to 7 days ahead and rejects anything later', async () => {
      await db
        .asUser('user_alice')
        .query(`select public.set_status('away', null, now() + interval '7 days')`);
      await expect(
        db
          .asUser('user_alice')
          .query(`select public.set_status('away', null, now() + interval '7 days 1 second')`),
      ).rejects.toThrow(/ends_at must be at most 7 days away/);
      await expect(setStatus('user_alice', 'away', null, '2999-01-01T00:00:00Z')).rejects.toThrow(
        /at most 7 days away/,
      );
    });
  });

  describe('label', () => {
    it('accepts 40 characters, counting an emoji as one', async () => {
      expect((await setStatus('user_alice', 'busy', 'x'.repeat(40))).label).toHaveLength(40);
      expect((await setStatus('user_alice', 'busy', '📚'.repeat(40))).label).toBe('📚'.repeat(40));
    });

    it('rejects 41 characters', async () => {
      await expect(setStatus('user_alice', 'busy', 'x'.repeat(41))).rejects.toThrow(
        /Label must be at most 40 characters/,
      );
    });

    it('treats a blank label as none', async () => {
      expect((await setStatus('user_alice', 'busy', '   ')).label).toBeNull();
      expect((await setStatus('user_alice', 'busy', '')).label).toBeNull();
    });

    it('rejects control characters', async () => {
      await expect(setStatus('user_alice', 'busy', 'a\nb')).rejects.toThrow(
        /Label must not contain control characters/,
      );
      await expect(setStatus('user_alice', 'busy', 'a\u001bb')).rejects.toThrow(
        /control characters/,
      );
    });
  });

  it('refuses a caller with no users row yet', async () => {
    await expect(setStatus('user_nobody', 'busy')).rejects.toThrow(
      /User profile not found: call ensure_current_user first/,
    );
  });

  it('takes no user argument', async () => {
    const { rows } = await db.admin.query<{ args: string }>(
      `select pg_get_function_arguments('public.set_status(text, text, timestamptz)'::regprocedure) as args`,
    );
    expect(rows[0]?.args).toBe(
      'status text, label text DEFAULT NULL::text, ends_at timestamp with time zone DEFAULT NULL::timestamp with time zone',
    );
  });
});

describe('clear_status()', () => {
  it('ends the current status now, keeping it as history', async () => {
    const row = await setStatus('user_alice', 'dnd');
    await backdate(row.id, 1);
    await db.asUser('user_alice').query(`select public.clear_status()`);
    const [closed] = await overridesOf(alice);
    expect(closed?.ends_at).not.toBeNull();
    expect(await activeOf(alice)).toEqual([]);
  });

  it('removes a status set in the same transaction', async () => {
    await db.asUser('user_alice').run(async (tx) => {
      await tx.query(`select public.set_status('dnd')`);
      await tx.query(`select public.clear_status()`);
    });
    expect(await overridesOf(alice)).toEqual([]);
  });

  it('is a no-op when nothing is active, and leaves other users alone', async () => {
    const bobs = await setStatus('user_bob', 'away');
    await db.asUser('user_alice').query(`select public.clear_status()`);
    expect(await overridesOf(alice)).toEqual([]);
    expect(await overridesOf(bob)).toEqual([bobs]);
  });

  it('refuses a caller with no users row yet', async () => {
    await expect(db.asUser('user_nobody').query(`select public.clear_status()`)).rejects.toThrow(
      /User profile not found/,
    );
  });
});

describe('RLS and privileges', () => {
  it('the owner reads their own overrides only', async () => {
    const mine = await setStatus('user_alice', 'busy');
    await setStatus('user_bob', 'dnd', 'Secret label');
    const rows = await db.asUser('user_alice').query(`select id from public.status_overrides`);
    expect(rows).toEqual([{ id: mine.id }]);
    const byId = await db
      .asUser('user_alice')
      .query(`select * from public.status_overrides where user_id = $1`, [bob]);
    expect(byId).toEqual([]);
  });

  it('users can’t write overrides directly (no backdating or scheduling ahead)', async () => {
    const row = await setStatus('user_alice', 'busy');
    const alice_ = db.asUser('user_alice');
    await expect(
      alice_.query(
        `insert into public.status_overrides (user_id, status, starts_at) values ($1, 'free', '2020-01-01')`,
        [alice],
      ),
    ).rejects.toThrow(/permission denied for table status_overrides/);
    await expect(
      alice_.query(`update public.status_overrides set ends_at = null where id = $1`, [row.id]),
    ).rejects.toThrow(/permission denied for table status_overrides/);
    await expect(alice_.query(`delete from public.status_overrides`)).rejects.toThrow(
      /permission denied for table status_overrides/,
    );
  });

  it('anon can’t read the table or call the functions', async () => {
    await expect(db.asAnon().query(`select * from public.status_overrides`)).rejects.toThrow(
      /permission denied for table status_overrides/,
    );
    await expect(db.asAnon().query(`select public.set_status('free')`)).rejects.toThrow(
      /permission denied for function set_status/,
    );
    await expect(db.asAnon().query(`select public.clear_status()`)).rejects.toThrow(
      /permission denied for function clear_status/,
    );
  });

  it('the service role can’t call set_status (it has no user)', async () => {
    await expect(db.asService().query(`select public.set_status('free')`)).rejects.toThrow(
      /permission denied for function set_status/,
    );
  });

  it('overrides are deleted with the user', async () => {
    await setStatus('user_alice', 'busy');
    await db.admin.query(`delete from public.users where id = $1`, [alice]);
    expect(await overridesOf(alice)).toEqual([]);
  });
});

describe('private.purge_expired_status_overrides()', () => {
  it('deletes overrides that ended more than the retention ago, and nothing else', async () => {
    const old = await setStatus('user_alice', 'busy', null, inHours(1));
    await backdate(old.id, 24 * 8 + 1); // ended 8 days ago
    const recent = await setStatus('user_alice', 'away', null, inHours(1));
    await backdate(recent.id, 3); // ended 2 hours ago
    const open = await setStatus('user_alice', 'dnd');
    const bobs = await setStatus('user_bob', 'free');

    const { rows } = await db.admin.query(
      `select private.purge_expired_status_overrides() as deleted`,
    );
    expect(rows).toEqual([{ deleted: 1 }]);
    expect((await overridesOf(alice)).map((r) => r.id)).toEqual([recent.id, open.id]);
    expect(await overridesOf(bob)).toEqual([bobs]);

    const { rows: again } = await db.admin.query(
      `select private.purge_expired_status_overrides(interval '1 hour') as deleted`,
    );
    expect(again).toEqual([{ deleted: 1 }]);
    expect((await overridesOf(alice)).map((r) => r.id)).toEqual([open.id]);
  });

  it('rejects a negative retention', async () => {
    await expect(
      db.admin.query(`select private.purge_expired_status_overrides(interval '-1 day')`),
    ).rejects.toThrow(/retention must be a non-negative interval/);
  });

  it('clients can’t call it', async () => {
    for (const session of [db.asUser('user_alice'), db.asAnon(), db.asService()]) {
      await expect(
        session.query(`select private.purge_expired_status_overrides()`),
      ).rejects.toThrow(/permission denied for schema private/);
    }
  });
});
