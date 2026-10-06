// WF-137: in-app feedback (FR-WEB-10). Submitting through `submit_feedback`, validation, the
// rate limit, and isolation: no client can read feedback back, its author included, and nobody
// can write the table directly (NFR-SEC-2, NFR-SEC-9, D41).

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FEEDBACK_PER_DAY } from '@synkd/shared';
import { FEEDBACK_ERRORS } from '../src/index';
import { createTestDb } from './harness/db';
import type { TestDb } from './harness/db';
import { expectPgError, setRateCount } from './harness/groups';
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

interface Submit {
  kind?: string | null;
  message?: string | null;
  page?: string | null;
  device?: string | null;
  installed?: boolean | null;
  canContact?: boolean | null;
}

async function submit(clerkId: string, input: Submit = {}): Promise<string> {
  const [row] = await db
    .asUser(clerkId)
    .query<{ id: string }>(`select public.submit_feedback($1, $2, $3, $4, $5, $6) as id`, [
      input.kind === undefined ? 'bug' : input.kind,
      input.message === undefined ? 'The Now screen says I’m busy' : input.message,
      input.page === undefined ? '/now' : input.page,
      input.device ?? null,
      input.installed ?? false,
      input.canContact ?? false,
    ]);
  if (row === undefined) throw new Error('submit_feedback returned no row');
  return row.id;
}

async function rowsOf(userId: string) {
  const { rows } = await db.admin.query<{
    kind: string;
    message: string;
    page: string | null;
    device_label: string | null;
    installed: boolean;
    can_contact: boolean;
    status: string;
  }>(
    `select kind, message, page, device_label, installed, can_contact, status
     from public.feedback where user_id = $1 order by created_at, id`,
    [userId],
  );
  return rows;
}

describe('submit_feedback', () => {
  it('stores the feedback for the caller, as new', async () => {
    await submit('user_alice', {
      kind: 'idea',
      message: '  Dark mode please\r\n\tThanks ',
      page: '/groups/abc/settings',
      device: 'Safari on iPhone',
      installed: true,
      canContact: true,
    });
    expect(await rowsOf(alice)).toEqual([
      {
        kind: 'idea',
        message: 'Dark mode please\n\tThanks',
        page: '/groups/abc/settings',
        device_label: 'Safari on iPhone',
        installed: true,
        can_contact: true,
        status: 'new',
      },
    ]);
    expect(await rowsOf(bob)).toEqual([]);
  });

  it('accepts no page, no device and 2000 characters', async () => {
    await submit('user_alice', { page: null, message: '🐛'.repeat(2000) });
    const [row] = await rowsOf(alice);
    expect(row?.page).toBeNull();
    expect(row?.device_label).toBeNull();
  });

  it('rejects a blank, overlong or control-character message', async () => {
    for (const message of [null, '   ', 'a'.repeat(2001), 'a\u0007b', 'a\rb']) {
      await expectPgError(
        submit('user_alice', { message }),
        FEEDBACK_ERRORS.invalidMessage,
        '22023',
      );
    }
  });

  it('rejects an unknown kind', async () => {
    for (const kind of [null, 'rant']) {
      await expectPgError(submit('user_alice', { kind }), FEEDBACK_ERRORS.invalidKind, '22023');
    }
  });

  it('accepts only a bare path as the page (no query string or hash)', async () => {
    for (const page of ['/i/abc?ref=1', '/now#x', 'https://x.test/now', `/${'a'.repeat(200)}`]) {
      await expectPgError(submit('user_alice', { page }), FEEDBACK_ERRORS.invalidPage, '22023');
    }
  });

  it('rejects an overlong device label', async () => {
    await expectPgError(
      submit('user_alice', { device: 'x'.repeat(61) }),
      FEEDBACK_ERRORS.invalidDeviceLabel,
      '22023',
    );
  });

  it(`is rate limited to ${FEEDBACK_PER_DAY} a day (NFR-SEC-9); a refused call uses nothing`, async () => {
    await setRateCount(db, alice, 'feedback', FEEDBACK_PER_DAY - 1);
    await expectPgError(submit('user_alice', { message: ' ' }), FEEDBACK_ERRORS.invalidMessage);
    await submit('user_alice');
    await expectPgError(submit('user_alice'), FEEDBACK_ERRORS.rateLimited, 'PT429');
    expect(await rowsOf(alice)).toHaveLength(1);
    // Per user: Bob is unaffected.
    await submit('user_bob');
  });

  it('needs an account', async () => {
    await expectPgError(submit('user_no_row'), FEEDBACK_ERRORS.noAccount, 'WF001');
  });

  it('is not callable signed out', async () => {
    await expect(db.asAnon().query(`select public.submit_feedback('bug', 'hi')`)).rejects.toThrow(
      /permission denied for function submit_feedback\b/,
    );
  });
});

describe('feedback table', () => {
  it('no client can read it, its author included', async () => {
    await submit('user_alice');
    await expect(db.asUser('user_alice').query(`select * from public.feedback`)).rejects.toThrow(
      /permission denied for table feedback/,
    );
    await expect(db.asAnon().query(`select * from public.feedback`)).rejects.toThrow(
      /permission denied for table feedback/,
    );
  });

  it('no client can write it directly', async () => {
    await expect(
      db
        .asUser('user_alice')
        .query(`insert into public.feedback (user_id, kind, message) values ($1, 'bug', 'x')`, [
          alice,
        ]),
    ).rejects.toThrow(/permission denied for table feedback/);
  });

  it('deleting the account deletes its feedback', async () => {
    await submit('user_alice');
    await submit('user_bob');
    await db.admin.query(`delete from public.users where id = $1`, [alice]);
    expect(await rowsOf(alice)).toEqual([]);
    expect(await rowsOf(bob)).toHaveLength(1);
  });
});
