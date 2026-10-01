// WF-026/027/030/032/035/037/127: schedule uploads, parse jobs and Storage removals. Covers
// registering an upload (and reusing an identical one), owner-only reads, the 5-a-day parse
// limit (offline friends' parses too), the server's claim / complete / fail cycle with leases
// and backoff, confirming (commit + job committed + draft and file row deleted, D38), deleting a
// pending upload, expiry, the removal queue, the Realtime signal and who may call what.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_PENDING_UPLOADS,
  PARSE_ATTEMPTS_PER_DAY,
  PARSE_JOB_MAX_ATTEMPTS,
  SCHEDULE_UPLOADS_PER_DAY,
} from '@whosfree/shared';
import { DB_ERROR, SCHEDULE_FILE_ERRORS } from '../src/index';
import { createTestDb } from './harness/db';
import type { TestDb } from './harness/db';
import { codeOf, errorOf } from './harness/errors';
import { expectNoExecute, expectPgError, setRateCount } from './harness/groups';
import { addUser } from './harness/seed';

let db: TestDb;
let alice: string;
let tash: string;

beforeAll(async () => {
  db = await createTestDb();
});
afterAll(() => db.close());

beforeEach(async () => {
  await db.reset();
  alice = await addUser(db, 'user_alice');
  await addUser(db, 'user_bob');
  const [row] = await db
    .asUser('user_alice')
    .query<{ id: string }>(`select public.create_offline_friend('Tash', null, true) as id`);
  tash = row?.id as string;
  await db.admin.query(`delete from realtime.messages`);
});

const hash = (n: number) => n.toString(16).padStart(64, '0');

interface Upload {
  file_id: string;
  storage_path: string;
  job_id: string | null;
  needs_upload: boolean;
}

async function upload(
  clerkId: string,
  opts: { sha?: string; friend?: string | null; name?: string; mime?: string; size?: number } = {},
): Promise<Upload> {
  const rows = await db
    .asUser(clerkId)
    .query<Upload & Record<string, unknown>>(
      `select * from public.create_schedule_upload($1, $2, $3, $4, $5)`,
      [
        opts.name ?? 'Sem1 timetable.pdf',
        opts.mime ?? 'application/pdf',
        opts.size ?? 123_456,
        opts.sha ?? hash(1),
        opts.friend ?? null,
      ],
    );
  expect(rows).toHaveLength(1);
  return rows[0] as Upload;
}

async function start(clerkId: string, fileId: string): Promise<string> {
  const [row] = await db
    .asUser(clerkId)
    .query<{ id: string }>(`select public.start_parse_job($1) as id`, [fileId]);
  return row?.id as string;
}

interface Run {
  id: string;
  attempt: number;
  storage_path: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
}

async function claim(jobId: string): Promise<Run | undefined> {
  const rows = await db
    .asService()
    .query<Run & Record<string, unknown>>(`select * from public.claim_parse_job($1, 300)`, [jobId]);
  return rows[0];
}

const event = (overrides: Record<string, unknown> = {}) => ({
  title: 'COMP2140 Lecture',
  category: 'class',
  start: '10:00',
  end: '12:00',
  when: { kind: 'weekly', days: ['mon', 'wed'], pattern: { type: 'every' } },
  confidence: 0.9,
  ...overrides,
});
const parseDraft = { events: [event(), event({ title: 'MATH1141 Tutorial', confidence: 0.4 })] };
const commitDraft = {
  events: [event()],
  period: { start: '2026-08-31', end: '2026-12-12', exceptions: [] },
};

async function complete(jobId: string, attempt: number, draft: unknown = parseDraft) {
  const [row] = await db
    .asService()
    .query<{ ok: boolean }>(
      `select public.complete_parse_job($1, $2, $3::jsonb, 'test/model', '1.0+prompt.v2', 0.0012, 0.65, 2) as ok`,
      [jobId, attempt, JSON.stringify(draft)],
    );
  return row?.ok;
}

async function fail(jobId: string, attempt: number, error: string, retryable: boolean) {
  const [row] = await db
    .asService()
    .query<{ status: string | null }>(
      `select public.fail_parse_job($1, $2, $3, $4, 'test/model', '1.0+prompt.v2', 0.001) as status`,
      [jobId, attempt, error, retryable],
    );
  return row?.status;
}

async function job(jobId: string) {
  const { rows } = await db.admin.query<{
    status: string;
    attempts: number;
    draft: unknown;
    error: string | null;
    file_id: string | null;
    cost_usd: string;
    model: string | null;
    lease_until: string | null;
    next_attempt_at: string;
  }>(`select * from public.parse_jobs where id = $1`, [jobId]);
  return rows[0];
}

/** A job that has been parsed and is waiting for review. */
async function readyJob(clerkId = 'user_alice', friend: string | null = null) {
  const u = await upload(clerkId, { friend, sha: hash(friend ? 9 : 1) });
  const jobId = await start(clerkId, u.file_id);
  const run = await claim(jobId);
  expect(await complete(jobId, run?.attempt ?? 0)).toBe(true);
  return { ...u, jobId };
}

async function removals(): Promise<string[]> {
  const { rows } = await db.admin.query<{ storage_path: string }>(
    `select storage_path from public.storage_removals order by storage_path`,
  );
  return rows.map((r) => r.storage_path);
}

describe('create_schedule_upload (WF-026)', () => {
  it('registers a pending file at a server-chosen path, deleted after 7 days', async () => {
    const u = await upload('user_alice', { name: 'C:\\Users\\me\\My timetable.pdf' });
    expect(u.storage_path).toBe(`${alice}/${u.file_id}`);
    expect(u).toMatchObject({ job_id: null, needs_upload: true });
    const { rows } = await db.admin.query<{ file_name: string; days: number; sha256: string }>(
      `select file_name, sha256, (extract(epoch from delete_at - uploaded_at) / 86400)::integer as days
       from public.schedule_files where id = $1`,
      [u.file_id],
    );
    expect(rows[0]).toEqual({ file_name: 'My timetable.pdf', sha256: hash(1), days: 7 });
  });

  it('checks the type, size and hash', async () => {
    await expectPgError(
      upload('user_alice', { mime: 'text/html' }),
      SCHEDULE_FILE_ERRORS.unsupportedType,
      '22023',
    );
    await expectPgError(
      upload('user_alice', { size: 10 * 1024 * 1024 + 1 }),
      SCHEDULE_FILE_ERRORS.invalidSize,
      '22023',
    );
    await expectPgError(upload('user_alice', { sha: 'xyz' }), SCHEDULE_FILE_ERRORS.invalidHash);
  });

  it('uploads for one of the caller’s offline friends only (WF-127)', async () => {
    const u = await upload('user_alice', { friend: tash });
    const { rows } = await db.admin.query(
      `select offline_friend_id from public.schedule_files where id = $1`,
      [u.file_id],
    );
    expect(rows[0]).toEqual({ offline_friend_id: tash });
    await expectPgError(
      upload('user_bob', { friend: tash }),
      SCHEDULE_FILE_ERRORS.offlineFriendNotFound,
      'P0002',
    );
  });

  it('reuses an identical pending file for the same person instead of a new upload (WF-035)', async () => {
    const first = await upload('user_alice');
    // No job yet: the first upload may not have finished, so upload again (same path).
    const again = await upload('user_alice');
    expect(again).toEqual({ ...first, needs_upload: true });
    const jobId = await start('user_alice', first.file_id);
    expect(await upload('user_alice')).toEqual({ ...first, job_id: jobId, needs_upload: false });
    // The same bytes for an offline friend, or from someone else, are separate uploads.
    expect((await upload('user_alice', { friend: tash })).file_id).not.toBe(first.file_id);
    expect((await upload('user_bob')).file_id).not.toBe(first.file_id);
  });

  it(`allows at most ${MAX_PENDING_UPLOADS} pending files`, async () => {
    for (let i = 0; i < MAX_PENDING_UPLOADS; i++)
      await upload('user_alice', { sha: hash(100 + i) });
    await expectPgError(
      upload('user_alice', { sha: hash(999) }),
      SCHEDULE_FILE_ERRORS.tooManyPending,
      'P0001',
    );
  });

  it(`allows ${SCHEDULE_UPLOADS_PER_DAY} new uploads a day`, async () => {
    await setRateCount(db, alice, 'schedule_upload', SCHEDULE_UPLOADS_PER_DAY);
    const error = await errorOf(upload('user_alice'));
    expect(error.code).toBe(DB_ERROR.rateLimited);
  });

  it('signals the owner’s channel with nothing in it', async () => {
    await upload('user_alice');
    const { rows } = await db.admin.query(
      `select topic, event, payload, private from realtime.messages`,
    );
    expect(rows).toEqual([
      { topic: `user:${alice}`, event: 'parse_job_changed', payload: {}, private: true },
    ]);
  });
});

describe('reading uploads and jobs (owner-only RLS)', () => {
  it('the owner reads their own; nobody else reads anything', async () => {
    const { jobId, file_id } = await readyJob();
    const own = await db.asUser('user_alice')
      .query(`select j.id, j.status, j.draft, f.file_name from public.parse_jobs j
              join public.schedule_files f on f.id = j.file_id`);
    expect(own).toEqual([
      { id: jobId, status: 'needs_review', draft: parseDraft, file_name: 'Sem1 timetable.pdf' },
    ]);
    expect(await db.asUser('user_bob').query(`select id from public.parse_jobs`)).toEqual([]);
    expect(await db.asUser('user_bob').query(`select id from public.schedule_files`)).toEqual([]);
    expect(await codeOf(db.asAnon().query(`select id from public.parse_jobs`))).toBe('42501');
    expect(
      await codeOf(
        db
          .asUser('user_alice')
          .query(`select sha256 from public.schedule_files where id = $1`, [file_id]),
      ),
    ).toBe('42501');
    expect(
      await codeOf(
        db.asUser('user_alice').query(`select lease_until, cost_usd from public.parse_jobs`),
      ),
    ).toBe('42501');
  });

  it('nobody writes directly', async () => {
    const { jobId } = await readyJob();
    const me = db.asUser('user_alice');
    expect(
      await codeOf(
        me.query(`update public.parse_jobs set status = 'committed' where id = $1`, [jobId]),
      ),
    ).toBe('42501');
    expect(await codeOf(me.query(`delete from public.schedule_files`))).toBe('42501');
    expect(await codeOf(me.query(`select * from public.storage_removals`))).toBe('42501');
  });
});

describe('start_parse_job (WF-027, WF-035)', () => {
  it('queues one job per file and returns it again without using an attempt', async () => {
    const u = await upload('user_alice');
    const jobId = await start('user_alice', u.file_id);
    expect(await job(jobId)).toMatchObject({ status: 'queued', attempts: 0, file_id: u.file_id });
    expect(await start('user_alice', u.file_id)).toBe(jobId);
    const { rows } = await db.admin.query(
      `select count from public.rate_limits where user_id = $1 and action = 'parse'`,
      [alice],
    );
    expect(rows).toEqual([{ count: 1 }]);
  });

  it(`allows ${PARSE_ATTEMPTS_PER_DAY} parse attempts a day, offline friends’ included`, async () => {
    await setRateCount(db, alice, 'parse', PARSE_ATTEMPTS_PER_DAY - 1);
    const mine = await upload('user_alice');
    await start('user_alice', mine.file_id);
    const forTash = await upload('user_alice', { friend: tash, sha: hash(2) });
    const error = await errorOf(start('user_alice', forTash.file_id));
    expect(error.code).toBe(DB_ERROR.rateLimited);
    expect(error.message).toBe(SCHEDULE_FILE_ERRORS.rateLimited);
  });

  it('a duplicate file reuses the pending job of the identical one, for free', async () => {
    const first = await upload('user_alice');
    const jobId = await start('user_alice', first.file_id);
    // A second row for the same bytes (e.g. two tabs racing past the upload check).
    const { rows } = await db.admin.query<{ id: string }>(
      `insert into public.schedule_files (user_id, storage_path, file_name, mime_type, size_bytes,
         sha256, delete_at)
       values ($1::uuid, $1::text || '/' || gen_random_uuid(), 'copy.pdf', 'application/pdf', 10,
         $2, now() + interval '7 days') returning id`,
      [alice, hash(1)],
    );
    await setRateCount(db, alice, 'parse', PARSE_ATTEMPTS_PER_DAY);
    expect(await start('user_alice', rows[0]?.id as string)).toBe(jobId);
    const left = await db.admin.query(`select id from public.schedule_files where user_id = $1`, [
      alice,
    ]);
    expect(left.rows).toEqual([{ id: first.file_id }]);
  });

  it('retrying a failed job requeues it and uses an attempt (FR-IMP-14)', async () => {
    const u = await upload('user_alice');
    const jobId = await start('user_alice', u.file_id);
    const run = await claim(jobId);
    expect(await fail(jobId, run?.attempt ?? 0, 'unreadable_file', false)).toBe('failed');
    expect(await start('user_alice', u.file_id)).toBe(jobId);
    expect(await job(jobId)).toMatchObject({ status: 'queued', attempts: 0, error: null });
    const { rows } = await db.admin.query(
      `select count from public.rate_limits where user_id = $1 and action = 'parse'`,
      [alice],
    );
    expect(rows).toEqual([{ count: 2 }]);
  });

  it('only for the caller’s own, unexpired uploads', async () => {
    const u = await upload('user_alice');
    await expectPgError(start('user_bob', u.file_id), SCHEDULE_FILE_ERRORS.uploadNotFound, 'P0002');
    await db.admin.query(
      `update public.schedule_files set uploaded_at = now() - interval '8 days',
         delete_at = now() - interval '1 day' where id = $1`,
      [u.file_id],
    );
    await expectPgError(start('user_alice', u.file_id), SCHEDULE_FILE_ERRORS.uploadNotFound);
  });
});

describe('the server’s run cycle (claim, complete, fail)', () => {
  it('only the secret key can run it', async () => {
    const u = await upload('user_alice');
    const jobId = await start('user_alice', u.file_id);
    await expectNoExecute(
      db.asUser('user_alice').query(`select * from public.claim_parse_job($1)`, [jobId]),
      'claim_parse_job',
    );
    await expectNoExecute(
      db.asUser('user_alice').query(`select public.list_due_parse_jobs()`),
      'list_due_parse_jobs',
    );
    await expectNoExecute(
      db
        .asUser('user_alice')
        .query(`select public.complete_parse_job($1, 1, '{}', 'm', 'v', 0, 1, 1)`, [jobId]),
      'complete_parse_job',
    );
  });

  it('claims a queued job once, with a lease, and hands over what the run needs', async () => {
    const u = await upload('user_alice');
    const jobId = await start('user_alice', u.file_id);
    const run = await claim(jobId);
    expect(run).toEqual({
      id: jobId,
      attempt: 1,
      storage_path: u.storage_path,
      mime_type: 'application/pdf',
      size_bytes: 123_456,
      sha256: hash(1),
    });
    expect(await job(jobId)).toMatchObject({ status: 'processing', attempts: 1 });
    // Held: a second dispatch gets nothing.
    expect(await claim(jobId)).toBeUndefined();
  });

  it('stores the draft for review, and ignores a run that lost its lease', async () => {
    const u = await upload('user_alice');
    const jobId = await start('user_alice', u.file_id);
    await claim(jobId);
    expect(await complete(jobId, 2)).toBe(false);
    expect(await complete(jobId, 1)).toBe(true);
    expect(await job(jobId)).toMatchObject({
      status: 'needs_review',
      draft: parseDraft,
      model: 'test/model',
      cost_usd: '0.001200',
      lease_until: null,
    });
    const { rows } = await db.admin.query(`select pages from public.schedule_files where id = $1`, [
      u.file_id,
    ]);
    expect(rows).toEqual([{ pages: 2 }]);
    expect(await complete(jobId, 1)).toBe(false);
  });

  it('refuses a draft with a location in it (D35)', async () => {
    const u = await upload('user_alice');
    const jobId = await start('user_alice', u.file_id);
    await claim(jobId);
    const roomy = { events: [{ ...event(), location: 'SLT 2' }] };
    expect(await codeOf(complete(jobId, 1, roomy))).toBe(DB_ERROR.scheduleInvalid);
    expect(await codeOf(complete(jobId, 1, { ...parseDraft, room: 'B12' }))).toBe(
      DB_ERROR.scheduleInvalid,
    );
    expect(await job(jobId)).toMatchObject({ status: 'processing' });
  });

  it(`retries with backoff and fails for good after ${PARSE_JOB_MAX_ATTEMPTS} runs`, async () => {
    const u = await upload('user_alice');
    const jobId = await start('user_alice', u.file_id);
    await claim(jobId);
    expect(await fail(jobId, 1, 'parse_failed', true)).toBe('queued');
    const after1 = await job(jobId);
    const wait = Date.parse(after1?.next_attempt_at ?? '') - Date.now();
    expect(wait).toBeGreaterThan(50_000);
    expect(wait).toBeLessThan(70_000);
    // Not due yet.
    expect(await claim(jobId)).toBeUndefined();
    const due = () =>
      db.admin.query(`update public.parse_jobs set next_attempt_at = now() where id = $1`, [jobId]);
    await due();
    expect((await claim(jobId))?.attempt).toBe(2);
    expect(await fail(jobId, 2, 'parse_failed', true)).toBe('queued');
    await due();
    expect((await claim(jobId))?.attempt).toBe(3);
    expect(await fail(jobId, 3, 'parse_failed', true)).toBe('failed');
    expect(await job(jobId)).toMatchObject({
      status: 'failed',
      error: 'parse_failed',
      cost_usd: '0.003000',
    });
  });

  it('a failure no retry can fix fails straight away', async () => {
    const u = await upload('user_alice');
    const jobId = await start('user_alice', u.file_id);
    await claim(jobId);
    expect(await fail(jobId, 1, 'too_many_pages', false)).toBe('failed');
    expect(await job(jobId)).toMatchObject({ status: 'failed', error: 'too_many_pages' });
  });

  it('recovers a run that died: the sweep finds it once its lease runs out (NFR-REL-4)', async () => {
    const u = await upload('user_alice');
    const jobId = await start('user_alice', u.file_id);
    const due = async () =>
      (await db.asService().query<{ id: string }>(`select public.list_due_parse_jobs() as id`)).map(
        (r) => r.id,
      );
    expect(await due()).toEqual([jobId]);
    await claim(jobId);
    expect(await due()).toEqual([]);
    const expire = () =>
      db.admin.query(
        `update public.parse_jobs set lease_until = now() - interval '1 second' where id = $1`,
        [jobId],
      );
    await expire();
    expect(await due()).toEqual([jobId]);
    expect((await claim(jobId))?.attempt).toBe(2);
    await expire();
    expect((await claim(jobId))?.attempt).toBe(3);
    await expire();
    expect(await claim(jobId)).toBeUndefined();
    expect(await job(jobId)).toMatchObject({ status: 'failed', error: 'timed_out' });
  });
});

describe('confirm_parse_job (WF-030, D38)', () => {
  it('commits the schedule, marks the job committed and deletes its draft and file row', async () => {
    const { jobId, file_id, storage_path } = await readyJob();
    const [row] = await db.asUser('user_alice').query<{
      source_id: string;
      storage_path: string;
    }>(`select * from public.confirm_parse_job($1, $2::jsonb)`, [jobId, JSON.stringify(commitDraft)]);
    expect(row?.storage_path).toBe(storage_path);
    const sources = await db.admin.query(
      `select id, type, offline_friend_id from public.sources where user_id = $1`,
      [alice],
    );
    expect(sources.rows).toEqual([{ id: row?.source_id, type: 'upload', offline_friend_id: null }]);
    expect(await job(jobId)).toMatchObject({ status: 'committed', draft: null, file_id: null });
    const files = await db.admin.query(`select id from public.schedule_files where id = $1`, [
      file_id,
    ]);
    expect(files.rows).toEqual([]);
    // Queued in case the server's immediate removal fails.
    expect(await removals()).toEqual([storage_path]);
  });

  it('saves an offline friend’s upload as their schedule (WF-127)', async () => {
    const { jobId } = await readyJob('user_alice', tash);
    await db
      .asUser('user_alice')
      .query(`select * from public.confirm_parse_job($1, $2::jsonb)`, [
        jobId,
        JSON.stringify(commitDraft),
      ]);
    const sources = await db.admin.query(
      `select type, offline_friend_id from public.sources where user_id = $1`,
      [alice],
    );
    expect(sources.rows).toEqual([{ type: 'upload', offline_friend_id: tash }]);
  });

  it('is all or nothing: an invalid draft leaves the job and file as they were', async () => {
    const { jobId, file_id } = await readyJob();
    const bad = { ...commitDraft, events: [{ ...event(), location: 'SLT 2' }] };
    expect(
      await codeOf(
        db
          .asUser('user_alice')
          .query(`select * from public.confirm_parse_job($1, $2::jsonb)`, [
            jobId,
            JSON.stringify(bad),
          ]),
      ),
    ).toBe(DB_ERROR.scheduleInvalid);
    expect(await job(jobId)).toMatchObject({ status: 'needs_review', file_id });
    expect(await removals()).toEqual([]);
  });

  it('refuses a second confirm, a job that isn’t ready, and someone else’s job', async () => {
    const { jobId } = await readyJob();
    const confirm = (clerkId: string, id: string) =>
      db
        .asUser(clerkId)
        .query(`select * from public.confirm_parse_job($1, $2::jsonb)`, [
          id,
          JSON.stringify(commitDraft),
        ]);
    await expectPgError(confirm('user_bob', jobId), SCHEDULE_FILE_ERRORS.parseJobNotFound, 'P0002');
    await confirm('user_alice', jobId);
    const again = await db
      .asUser('user_alice')
      .run((tx) =>
        tx
          .query(`select * from public.confirm_parse_job($1, $2::jsonb)`, [
            jobId,
            JSON.stringify(commitDraft),
          ])
          .catch((e: { code: string; detail: string }) => e),
      );
    expect(again).toMatchObject({ code: DB_ERROR.parseJobNotReady, detail: 'committed' });

    const u = await upload('user_alice', { sha: hash(5) });
    const queued = await start('user_alice', u.file_id);
    await expectPgError(confirm('user_alice', queued), SCHEDULE_FILE_ERRORS.notReady, 'WF403');
  });
});

describe('delete_schedule_upload (WF-032)', () => {
  it('deletes a pending upload with its job and draft, and queues the object', async () => {
    const { jobId, file_id, storage_path } = await readyJob();
    await expectPgError(
      db.asUser('user_bob').query(`select public.delete_schedule_upload($1)`, [file_id]),
      SCHEDULE_FILE_ERRORS.uploadNotFound,
      'P0002',
    );
    const [row] = await db
      .asUser('user_alice')
      .query<{ path: string }>(`select public.delete_schedule_upload($1) as path`, [file_id]);
    expect(row?.path).toBe(storage_path);
    expect(await job(jobId)).toBeUndefined();
    expect(await removals()).toEqual([storage_path]);
  });

  it('deleting an offline friend deletes their uploads too, and queues the objects', async () => {
    const u = await upload('user_alice', { friend: tash });
    await db.asUser('user_alice').query(`select public.delete_offline_friend($1)`, [tash]);
    expect(await removals()).toEqual([u.storage_path]);
  });
});

describe('the sweep: expiry and Storage removals (WF-037, D38)', () => {
  it('deletes files past delete_at with their jobs, and counts them', async () => {
    const old = await upload('user_alice');
    const oldJob = await start('user_alice', old.file_id);
    const fresh = await upload('user_alice', { sha: hash(2) });
    await db.admin.query(
      `update public.schedule_files set uploaded_at = now() - interval '8 days',
         delete_at = now() - interval '1 day' where id = $1`,
      [old.file_id],
    );
    await expectNoExecute(
      db.asUser('user_alice').query(`select public.expire_schedule_files()`),
      'expire_schedule_files',
    );
    const [row] = await db
      .asService()
      .query<{ n: number }>(`select public.expire_schedule_files() as n`);
    expect(row?.n).toBe(1);
    expect(await job(oldJob)).toBeUndefined();
    expect(await removals()).toEqual([old.storage_path]);
    const left = await db.admin.query(`select id from public.schedule_files`);
    expect(left.rows).toEqual([{ id: fresh.file_id }]);
  });

  it('hands out due removals with backoff until they are finished', async () => {
    const a = await upload('user_alice');
    const b = await upload('user_alice', { sha: hash(2) });
    for (const u of [a, b]) {
      await db.asUser('user_alice').query(`select public.delete_schedule_upload($1)`, [u.file_id]);
    }
    const claimRemovals = () =>
      db
        .asService()
        .query<{ bucket: string; storage_path: string }>(
          `select * from public.claim_storage_removals(10) order by storage_path`,
        );
    expect(await claimRemovals()).toEqual(
      [a, b]
        .map((u) => ({ bucket: 'schedule-files', storage_path: u.storage_path }))
        .sort((x, y) => x.storage_path.localeCompare(y.storage_path)),
    );
    // Pushed back: a crashed run doesn't hand them out again straight away.
    expect(await claimRemovals()).toEqual([]);
    const [done] = await db
      .asService()
      .query<{ n: number }>(`select public.finish_storage_removals($1) as n`, [[a.storage_path]]);
    expect(done?.n).toBe(1);
    expect(await removals()).toEqual([b.storage_path]);
    await expectNoExecute(
      db.asUser('user_alice').query(`select * from public.claim_storage_removals()`),
      'claim_storage_removals',
    );
  });
});
