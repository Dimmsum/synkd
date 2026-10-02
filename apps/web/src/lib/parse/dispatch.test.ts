import { describe, expect, it, vi } from 'vitest';
import { dispatch, isStalled, QUEUED_STALL_SECONDS, type DispatchDeps } from './dispatch';

const JOB = '6f1c1a3e-9a52-4c1e-9f55-2b0d0c1e7a11';
const PATH = '/api/internal/parse-jobs/run';

function deps(over: Partial<DispatchDeps> = {}) {
  return {
    secret: 'a-long-enough-cron-secret-123456',
    base: 'https://app.test',
    post: vi.fn<DispatchDeps['post']>(async () => true),
    runHere: vi.fn<DispatchDeps['runHere']>(async () => {}),
    ...over,
  };
}

describe('dispatch (WF-131: a queued job is never left waiting)', () => {
  it('sends the job to the run route when it is configured', async () => {
    const d = deps();
    expect(await dispatch(JOB, PATH, d)).toBe('route');
    expect(d.post).toHaveBeenCalledWith(`https://app.test${PATH}`, d.secret, JOB);
    expect(d.runHere).not.toHaveBeenCalled();
  });

  it('runs the job here without CRON_SECRET or an app URL', async () => {
    for (const over of [{ secret: null }, { base: null }]) {
      const d = deps(over);
      expect(await dispatch(JOB, PATH, d)).toBe('here');
      expect(d.post).not.toHaveBeenCalled();
      expect(d.runHere).toHaveBeenCalledWith(JOB);
    }
  });

  it('runs the job here when the route refuses it or cannot be reached', async () => {
    const refused = deps({ post: vi.fn(async () => false) });
    expect(await dispatch(JOB, PATH, refused)).toBe('here');
    expect(refused.runHere).toHaveBeenCalledWith(JOB);

    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const unreachable = deps({
      post: vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    });
    expect(await dispatch(JOB, PATH, unreachable)).toBe('here');
    expect(unreachable.runHere).toHaveBeenCalledWith(JOB);
  });
});

describe('isStalled', () => {
  const now = new Date('2026-10-02T01:00:00Z');
  const ago = (s: number) => new Date(now.getTime() - s * 1000).toISOString();

  it('nudges a job queued for a while, not one just queued', () => {
    expect(isStalled({ status: 'queued', updatedAt: ago(QUEUED_STALL_SECONDS) }, now, 330)).toBe(
      true,
    );
    expect(isStalled({ status: 'queued', updatedAt: ago(2) }, now, 330)).toBe(false);
  });

  it('nudges a run only once its lease could have run out', () => {
    expect(isStalled({ status: 'processing', updatedAt: ago(331) }, now, 330)).toBe(true);
    expect(isStalled({ status: 'processing', updatedAt: ago(60) }, now, 330)).toBe(false);
  });

  it('leaves settled jobs alone', () => {
    for (const status of ['needs_review', 'committed', 'failed'] as const) {
      expect(isStalled({ status, updatedAt: ago(10_000) }, now, 330)).toBe(false);
    }
  });
});
