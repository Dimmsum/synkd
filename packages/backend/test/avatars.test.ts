// WF-040: profile photos (FR-AUTH-2, FR-SOC-6, D35, D43). The avatars bucket
// migration only runs on Supabase (PGlite has no `storage` schema), so it is
// checked here against a stand-in `storage` schema in a separate database. The
// rest checks the rule the bucket relies on: a photo's URL reaches other users
// only through block-aware functions, so someone blocked either way never gets
// the URL of a photo uploaded after the block.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AVATAR_BUCKET, AVATAR_STORED_MAX_BYTES } from '@whosfree/shared';
import { createTestDb, migrationFiles } from './harness/db';
import type { TestDb } from './harness/db';
import { addGroup, befriend, block } from './harness/seed';
import { addPerson } from './harness/social';

describe('the avatars bucket migration', () => {
  let pg: PGlite;

  // A database with just enough of Supabase Storage for the migration to see.
  beforeAll(async () => {
    pg = await PGlite.create();
    await pg.exec(
      await readFile(join(import.meta.dirname, 'harness', 'supabase-shim.sql'), 'utf8'),
    );
    await pg.exec(`
      create schema storage;
      create table storage.buckets (
        id text primary key,
        name text not null,
        public boolean default false,
        file_size_limit bigint,
        allowed_mime_types text[]
      );
      create table storage.objects (
        id uuid primary key default gen_random_uuid(),
        bucket_id text references storage.buckets (id),
        name text
      );
      alter table storage.objects enable row level security;
    `);
    for (const file of await migrationFiles()) await pg.exec(await readFile(file, 'utf8'));
  }, 60_000);
  afterAll(() => pg.close());

  const bucket = async () =>
    (await pg.query(`select * from storage.buckets where id = $1`, [AVATAR_BUCKET])).rows;

  it('creates a public bucket that takes only small WebP files', async () => {
    expect(await bucket()).toEqual([
      {
        id: AVATAR_BUCKET,
        name: AVATAR_BUCKET,
        public: true,
        file_size_limit: AVATAR_STORED_MAX_BYTES,
        allowed_mime_types: ['image/webp'],
      },
    ]);
  });

  it('gives clients no storage policies: no listing, uploading or deleting', async () => {
    expect((await pg.query(`select * from pg_policies where schemaname = 'storage'`)).rows).toEqual(
      [],
    );
  });

  it('can be applied again, and puts back the settings', async () => {
    await pg.exec(`update storage.buckets set public = false, allowed_mime_types = null`);
    const file = (await migrationFiles()).find((f) => f.endsWith('_avatars_bucket.sql'));
    await pg.exec(await readFile(file ?? '', 'utf8'));
    expect(await bucket()).toMatchObject([{ public: true, allowed_mime_types: ['image/webp'] }]);
  });
});

describe('photo URLs and blocks', () => {
  let db: TestDb;
  let alice: string;
  let bob: string;
  let group: string;
  let inviteCode: string;

  beforeAll(async () => {
    db = await createTestDb();
  });
  afterAll(() => db.close());
  beforeEach(async () => {
    await db.reset();
    alice = await addPerson(db, 'user_alice', 'alice');
    bob = await addPerson(db, 'user_bob', 'bob');
    await befriend(db, alice, bob);
    group = await addGroup(db, alice, [bob]);
    await db.admin.query(
      `insert into public.pings (sender_id, recipient_id, template, expires_at)
       values ($1, $2, 'Link up?', now() + interval '2 hours'),
              ($2, $1, 'Call me', now() + interval '2 hours')`,
      [alice, bob],
    );
    const [invite] = await db
      .asUser('user_alice')
      .query<{ code: string }>(`select code from public.create_friend_invite()`);
    inviteCode = invite?.code ?? '';
  });

  /**
   * Every client function whose result includes someone's photo, with a call that would
   * return the other person (`other` is the other one's id, `handle` their handle).
   */
  const CALLS: Record<string, (other: string, handle: string) => [string, unknown[]]> = {
    find_user_by_handle: (_o, handle) => [`select * from public.find_user_by_handle($1)`, [handle]],
    get_group_members: () => [`select * from public.get_group_members($1)`, [group]],
    get_profile: (other) => [`select * from public.get_profile($1)`, [other]],
    list_blocked_users: () => [`select * from public.list_blocked_users()`, []],
    list_friend_requests: () => [`select * from public.list_friend_requests()`, []],
    list_friends: () => [`select * from public.list_friends()`, []],
    list_inbox: () => [`select * from public.list_inbox()`, []],
    now_for_viewer: () => [`select * from public.now_for_viewer()`, []],
    preview_friend_invite: () => [`select * from public.preview_friend_invite($1)`, [inviteCode]],
  };

  it('CALLS lists every client function that returns a photo', async () => {
    const { rows } = await db.admin.query<{ fn: string }>(
      `select distinct p.proname as fn
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       cross join lateral unnest(p.proargnames, p.proargmodes) as a(name, mode)
       where n.nspname = 'public'
         and a.mode in ('o', 't')
         and a.name like '%avatar%'
         and (has_function_privilege('authenticated', p.oid, 'EXECUTE')
              or has_function_privilege('anon', p.oid, 'EXECUTE'))
       order by 1`,
    );
    expect(rows.map((r) => r.fn)).toEqual(Object.keys(CALLS).sort());
  });

  async function everything(clerkId: string, other: string, handle: string): Promise<string> {
    const out: unknown[] = [];
    for (const call of Object.values(CALLS)) {
      const [sql, params] = call(other, handle);
      out.push(await db.asUser(clerkId).query(sql, params));
    }
    return JSON.stringify(out);
  }

  const photo = (who: string) =>
    `https://example.supabase.co/storage/v1/object/public/avatars/${who}/x.webp`;
  const setPhoto = (id: string, url: string) =>
    db.admin.query(`update public.users set avatar_url = $2 where id = $1`, [id, url]);

  it('before a block, friends see each other’s photos', async () => {
    await setPhoto(alice, photo('alice-1'));
    expect(await everything('user_bob', alice, 'alice')).toContain(photo('alice-1'));
  });

  it('after a block, neither side can get a photo uploaded since, through any function', async () => {
    await db.asUser('user_alice').query(`select public.block_user($1)`, [bob]);
    await setPhoto(alice, photo('alice-2'));
    await setPhoto(bob, photo('bob-2'));

    // The blocked person: nothing at all.
    expect(await everything('user_bob', alice, 'alice')).not.toContain(photo('alice-2'));
    // The blocker sees the blocked person only on their own unblock list.
    const seen = await everything('user_alice', bob, 'bob');
    expect(seen.split(photo('bob-2')).length - 1).toBe(1);
    const [blocked] = await db
      .asUser('user_alice')
      .query(`select avatar_url from public.list_blocked_users()`);
    expect(blocked).toEqual({ avatar_url: photo('bob-2') });
  });

  it('the same when the other person made the block', async () => {
    await block(db, bob, alice);
    await setPhoto(bob, photo('bob-3'));
    expect(await everything('user_alice', bob, 'bob')).not.toContain(photo('bob-3'));
  });

  it('nobody can read another user’s row directly', async () => {
    await setPhoto(alice, photo('alice-4'));
    expect(
      await db
        .asUser('user_bob')
        .query(`select avatar_url from public.users where id = $1`, [alice]),
    ).toEqual([]);
  });
});
