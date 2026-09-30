// WF-015: versioned consent record (FR-SET-5), and account_status(), which
// tells the web app whether the user may use app routes (WF-004/005/015).

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb } from './harness/db';
import type { TestDb } from './harness/db';
import { addUser } from './harness/seed';

const CURRENT = '0.1-draft';

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
afterEach(() => publishVersion(CURRENT));

/** What a migration publishing a new terms/privacy version does. */
async function publishVersion(version: string): Promise<void> {
  await db.admin.query(
    `create or replace function public.current_consent_version() returns text
     language sql stable set search_path = '' as $$ select '${version}'::text $$`,
  );
}

const accept = (clerkId: string, version: unknown) =>
  db
    .asUser(clerkId)
    .query<{ at: Date }>(`select public.accept_consent($1) as at`, [version])
    .then((rows) => rows[0]?.at);

const status = (clerkId: string) =>
  db
    .asUser(clerkId)
    .query(`select * from public.account_status()`)
    .then((rows) => rows[0]);

async function consentFields(id: string) {
  const { rows } = await db.admin.query<{
    consent_version: string | null;
    consent_at: Date | null;
  }>(`select consent_version, consent_at from public.users where id = $1`, [id]);
  return rows[0];
}

describe('current_consent_version()', () => {
  it(`is ${CURRENT}, the version on the drafts in docs/legal`, async () => {
    const rows = await db
      .asUser('user_alice')
      .query(`select public.current_consent_version() as v`);
    expect(rows).toEqual([{ v: CURRENT }]);
  });

  it('cannot be called with only the anon key', async () => {
    await expect(db.asAnon().query(`select public.current_consent_version()`)).rejects.toThrow(
      /permission denied for function current_consent_version/,
    );
  });
});

describe('accept_consent()', () => {
  it('records the current version and the server’s time', async () => {
    const before = Date.now();
    const at = await accept('user_alice', CURRENT);
    expect(at?.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(await consentFields(alice)).toEqual({ consent_version: CURRENT, consent_at: at });
    expect(await consentFields(bob)).toEqual({ consent_version: null, consent_at: null });
  });

  it.each([
    ['an old version', '0.0.1', `'0.0.1'`],
    ['a future version', '9.9', `'9.9'`],
    ['an empty string', '', `''`],
    ['a version with different case', '0.1-DRAFT', `'0.1-DRAFT'`],
    ['null', null, 'NULL'],
  ])('refuses %s', async (_case, version, shown) => {
    await expect(accept('user_alice', version)).rejects.toThrow(
      `Consent version ${shown} is not the current version (${CURRENT})`,
    );
    expect(await consentFields(alice)).toEqual({ consent_version: null, consent_at: null });
  });

  it('accepting the same version again keeps the original time', async () => {
    const first = await accept('user_alice', CURRENT);
    expect(await accept('user_alice', CURRENT)).toEqual(first);
    expect((await consentFields(alice))?.consent_at).toEqual(first);
  });

  it('when the version changes, the old version is refused and the new one recorded', async () => {
    const first = await accept('user_alice', CURRENT);
    await publishVersion('1.0');
    await expect(accept('user_alice', CURRENT)).rejects.toThrow(
      /Consent version '0.1-draft' is not the current version \(1\.0\)/,
    );
    expect(await consentFields(alice)).toEqual({ consent_version: CURRENT, consent_at: first });
    const second = await accept('user_alice', '1.0');
    expect(await consentFields(alice)).toEqual({ consent_version: '1.0', consent_at: second });
    expect(second?.getTime()).toBeGreaterThanOrEqual(first?.getTime() ?? Infinity);
  });

  it('users can’t set the version or backdate the time directly', async () => {
    await expect(
      db
        .asUser('user_alice')
        .query(`update public.users set consent_version = '9.9', consent_at = '2020-01-01'`),
    ).rejects.toThrow(/permission denied for table users/);
    await expect(
      db.asUser('user_alice').query(`update public.users set consent_at = '2020-01-01'`),
    ).rejects.toThrow(/permission denied for table users/);
  });

  it('takes no time argument', async () => {
    const { rows } = await db.admin.query<{ args: string }>(
      `select pg_get_function_arguments('public.accept_consent(text)'::regprocedure) as args`,
    );
    expect(rows[0]?.args).toBe('version text');
  });

  it('a version without a time (or the reverse) is impossible', async () => {
    await expect(
      db.admin.query(`update public.users set consent_version = 'x' where id = $1`, [alice]),
    ).rejects.toThrow(/users_consent_complete/);
  });

  it('refuses a caller with no users row yet', async () => {
    await expect(accept('user_nobody', CURRENT)).rejects.toThrow(
      /User profile not found: call ensure_current_user first/,
    );
  });

  it('cannot be called with only the anon key or by the service role', async () => {
    for (const session of [db.asAnon(), db.asService()]) {
      await expect(session.query(`select public.accept_consent('${CURRENT}')`)).rejects.toThrow(
        /permission denied for function accept_consent/,
      );
    }
  });
});

describe('account_status()', () => {
  it('a signed-in user with no profile yet: nothing done', async () => {
    expect(await status('user_nobody')).toEqual({
      has_profile: false,
      age_confirmed: false,
      consent_version: null,
      current_consent_version: CURRENT,
      consent_required: true,
    });
  });

  it('follows the onboarding steps', async () => {
    expect(await status('user_alice')).toMatchObject({
      has_profile: true,
      age_confirmed: false,
      consent_required: true,
    });
    await db.asUser('user_alice').query(`select public.confirm_age(2000)`);
    expect(await status('user_alice')).toMatchObject({
      age_confirmed: true,
      consent_required: true,
    });
    await accept('user_alice', CURRENT);
    expect(await status('user_alice')).toEqual({
      has_profile: true,
      age_confirmed: true,
      consent_version: CURRENT,
      current_consent_version: CURRENT,
      consent_required: false,
    });
  });

  it('requires consent again after the version changes, until it is accepted', async () => {
    await accept('user_alice', CURRENT);
    await publishVersion('1.0');
    expect(await status('user_alice')).toMatchObject({
      consent_version: CURRENT,
      current_consent_version: '1.0',
      consent_required: true,
    });
    await accept('user_alice', '1.0');
    expect(await status('user_alice')).toMatchObject({
      consent_version: '1.0',
      consent_required: false,
    });
  });

  it('reports only on the caller', async () => {
    await accept('user_alice', CURRENT);
    await db.asUser('user_alice').query(`select public.confirm_age(2000)`);
    expect(await status('user_bob')).toMatchObject({
      has_profile: true,
      age_confirmed: false,
      consent_version: null,
      consent_required: true,
    });
  });

  it('cannot be called with only the anon key', async () => {
    await expect(db.asAnon().query(`select * from public.account_status()`)).rejects.toThrow(
      /permission denied for function account_status/,
    );
  });
});
