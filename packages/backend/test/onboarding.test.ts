// WF-068: onboarding progress (J1, FR-WEB-5). Steps done or skipped, and whether the flow is
// finished, so it can be resumed later on any device and finished users aren't sent back.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ONBOARDING_STEPS } from '@synkd/shared';
import { createTestDb } from './harness/db';
import type { TestDb } from './harness/db';
import { codeOf } from './harness/errors';
import { addUser } from './harness/seed';

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

const record = (clerkId: string, step: unknown, finish: unknown = false) =>
  db.asUser(clerkId).query(`select public.record_onboarding_step($1, $2)`, [step, finish]);

async function progress(id: string) {
  const { rows } = await db.admin.query<{
    onboarding_steps: string[];
    onboarded_at: Date | null;
  }>(`select onboarding_steps, onboarded_at from public.users where id = $1`, [id]);
  return rows[0];
}

describe('users onboarding columns', () => {
  it('start empty and unfinished for a new user', async () => {
    expect(await progress(alice)).toEqual({ onboarding_steps: [], onboarded_at: null });
  });

  it('are readable by their owner only', async () => {
    const own = await db
      .asUser('user_alice')
      .query(`select onboarding_steps, onboarded_at from public.users`);
    expect(own).toEqual([{ onboarding_steps: [], onboarded_at: null }]);
  });

  it('cannot be written directly by clients', async () => {
    expect(
      await codeOf(
        db
          .asUser('user_alice')
          .query(`update public.users set onboarded_at = now() where id = $1`, [alice]),
      ),
    ).toBe('42501');
    expect(
      await codeOf(
        db
          .asUser('user_alice')
          .query(`update public.users set onboarding_steps = '{hours}' where id = $1`, [alice]),
      ),
    ).toBe('42501');
  });
});

describe('record_onboarding_step(step, finish)', () => {
  it('records each step once, in the order they were passed', async () => {
    await record('user_alice', 'hours');
    await record('user_alice', 'schedule');
    await record('user_alice', 'hours');
    expect(await progress(alice)).toEqual({
      onboarding_steps: ['hours', 'schedule'],
      onboarded_at: null,
    });
  });

  it('accepts every step in ONBOARDING_STEPS', async () => {
    for (const step of ONBOARDING_STEPS) await record('user_alice', step);
    expect((await progress(alice))?.onboarding_steps).toEqual([...ONBOARDING_STEPS]);
  });

  it('refuses an unknown or missing step', async () => {
    expect(await codeOf(record('user_alice', 'tour'))).toBe('22023');
    expect(await codeOf(record('user_alice', null))).toBe('22023');
    expect((await progress(alice))?.onboarding_steps).toEqual([]);
  });

  it('with finish, records when onboarding ended and keeps the first time', async () => {
    await record('user_alice', 'install', true);
    const first = (await progress(alice))?.onboarded_at;
    expect(first).toBeInstanceOf(Date);
    await record('user_alice', 'install', true);
    await record('user_alice', 'hours', false);
    expect((await progress(alice))?.onboarded_at).toEqual(first);
  });

  it('only changes the caller', async () => {
    await record('user_alice', 'hours', true);
    expect(await progress(bob)).toEqual({ onboarding_steps: [], onboarded_at: null });
  });

  it('needs a users row (WF001) and a signed-in caller', async () => {
    expect(await codeOf(record('user_nobody', 'hours'))).toBe('WF001');
    expect(
      await codeOf(db.asAnon().query(`select public.record_onboarding_step('hours', false)`)),
    ).toBe('42501');
  });
});
