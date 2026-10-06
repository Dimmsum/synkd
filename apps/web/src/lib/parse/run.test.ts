import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ParseRun } from '@synkd/backend';
import type { ParseOutcome } from '@synkd/parser/node';
import { processRun, type RunDeps } from './run';

const BYTES = new TextEncoder().encode('%PDF-1.7 synthetic');
const SHA = createHash('sha256').update(BYTES).digest('hex');
const RUN: ParseRun = {
  id: '6f1c1a3e-9a52-4c1e-9f55-2b0d0c1e7a11',
  attempt: 2,
  storage_path: 'u/f',
  mime_type: 'application/pdf',
  size_bytes: BYTES.byteLength,
  sha256: SHA,
};
const DRAFT = {
  events: [
    {
      title: 'SECRET TITLE Lecture',
      category: 'class' as const,
      start: '09:00',
      end: '10:00',
      when: {
        kind: 'weekly' as const,
        days: ['mon' as const],
        pattern: { type: 'every' as const },
      },
      confidence: 0.8,
    },
  ],
};
const OK: ParseOutcome = {
  ok: true,
  draft: DRAFT,
  confidence: 0.8,
  model: 'test/model',
  costUsd: 0.002,
  parserVersion: 'v-test',
};

function deps(overrides: Partial<RunDeps> = {}, admin: Partial<RunDeps['admin']> = {}) {
  const calls = { complete: vi.fn(), fail: vi.fn(), parse: vi.fn(), remove: vi.fn() };
  const d: RunDeps = {
    admin: {
      download: async () => BYTES,
      complete: async (input) => {
        calls.complete(input);
        return true;
      },
      fail: async (input) => {
        calls.fail(input);
        return input.retryable && RUN.attempt < 3 ? 'queued' : 'failed';
      },
      remove: async (paths) => {
        calls.remove(paths);
        return true;
      },
      ...admin,
    },
    convert: async () => ({ ok: true, pages: 2, images: [{ bytes: new Uint8Array(1) }] }),
    parse: async (input) => {
      calls.parse(input);
      return OK;
    },
    apiKey: 'sk-test',
    ...overrides,
  };
  return { d, calls };
}

let logs: string[];
beforeEach(() => {
  logs = [];
  for (const level of ['warn', 'error', 'log', 'info'] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    });
  }
});
afterEach(() => vi.restoreAllMocks());

describe('processRun (WF-027)', () => {
  it('stores a validated draft with model, cost, pages and the run’s attempt', async () => {
    const { d, calls } = deps();
    expect(await processRun(RUN, d)).toBe('ready');
    expect(calls.parse).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'sk-test', attempt: 2 }),
    );
    expect(calls.complete).toHaveBeenCalledWith({
      jobId: RUN.id,
      attempt: 2,
      draft: DRAFT,
      model: 'test/model',
      parserVersion: 'v-test',
      costUsd: 0.002,
      confidence: 0.8,
      pages: 2,
    });
  });

  it('fails for good when the upload is missing, too big or not the registered file', async () => {
    const missing = deps({}, { download: async () => null });
    expect(await processRun(RUN, missing.d)).toBe('failed');
    expect(missing.calls.fail).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'file_missing', retryable: false }),
    );
    const swapped = deps({}, { download: async () => new TextEncoder().encode('%PDF other') });
    await processRun(RUN, swapped.d);
    expect(swapped.calls.fail).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'unsupported_file', retryable: false }),
    );
    expect(swapped.calls.parse).not.toHaveBeenCalled();
  });

  it('records a conversion refusal without calling the model', async () => {
    const { d, calls } = deps({ convert: async () => ({ ok: false, code: 'too_many_pages' }) });
    expect(await processRun(RUN, d)).toBe('failed');
    expect(calls.fail).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'too_many_pages', retryable: false }),
    );
    expect(calls.parse).not.toHaveBeenCalled();
  });

  it('retries when something on our side breaks (download, conversion crash, no key)', async () => {
    const download = deps(
      {},
      {
        download: async () => {
          throw new Error('Storage download failed (503)');
        },
      },
    );
    expect(await processRun(RUN, download.d)).toBe('retry');
    const crash = deps({
      convert: async () => {
        throw new RangeError('wasm');
      },
    });
    expect(await processRun(RUN, crash.d)).toBe('retry');
    const noKey = deps({ apiKey: null });
    expect(await processRun(RUN, noKey.d)).toBe('retry');
    expect(noKey.calls.parse).not.toHaveBeenCalled();
  });

  it('passes on the model’s verdict: retryable or not, with what the run cost', async () => {
    const { d, calls } = deps({
      parse: async () => ({
        ok: false,
        code: 'no_schedule_found',
        retryable: false,
        kind: 'no_events',
        model: 'test/model',
        costUsd: 0.001,
        parserVersion: 'v-test',
      }),
    });
    expect(await processRun(RUN, d)).toBe('failed');
    expect(calls.fail).toHaveBeenCalledWith({
      jobId: RUN.id,
      attempt: 2,
      error: 'no_schedule_found',
      retryable: false,
      model: 'test/model',
      parserVersion: 'v-test',
      costUsd: 0.001,
    });
  });

  it('reports a run that lost its lease as stale', async () => {
    const { d } = deps({}, { complete: async () => false });
    expect(await processRun(RUN, d)).toBe('stale');
  });

  it('never logs a title, the draft or the file (NFR-SEC-11)', async () => {
    const failing = deps(
      {},
      {
        complete: async () => {
          throw new Error('complete_parse_job failed (WF401)');
        },
      },
    );
    await processRun(RUN, failing.d);
    await processRun(
      RUN,
      deps({
        parse: async () =>
          ({
            ...OK,
            ok: false,
            code: 'parse_failed',
            retryable: true,
            kind: 'schema_invalid',
          }) as ParseOutcome,
      }).d,
    );
    expect(logs.join('\n')).not.toMatch(/SECRET|PDF|u\/f/);
  });
});

describe('processRun: a rejected file is deleted straight away (WF-136, D38)', () => {
  it('removes the stored bytes when the file itself is unusable', async () => {
    const { d, calls } = deps({ convert: async () => ({ ok: false, code: 'unsupported_file' }) });
    expect(await processRun(RUN, d)).toBe('failed');
    expect(calls.fail).toHaveBeenCalledWith(expect.objectContaining({ error: 'unsupported_file' }));
    expect(calls.remove).toHaveBeenCalledWith([RUN.storage_path]);
  });

  it('keeps the file when trying again could still help, or nothing was found in it', async () => {
    const retry = deps({}, { download: async () => Promise.reject(new Error('network')) });
    expect(await processRun(RUN, retry.d)).toBe('retry');
    expect(retry.calls.remove).not.toHaveBeenCalled();

    const empty = deps({
      parse: async (): Promise<ParseOutcome> => ({
        ok: false,
        code: 'no_schedule_found',
        retryable: false,
        kind: 'no_events',
        model: 'test/model',
        parserVersion: 'v-test',
        costUsd: 0.001,
      }),
    });
    expect(await processRun(RUN, empty.d)).toBe('failed');
    expect(empty.calls.remove).not.toHaveBeenCalled();
  });

  it('still reports the failure when the removal fails', async () => {
    const { d } = deps(
      { convert: async () => ({ ok: false, code: 'unreadable_file' }) },
      { remove: async () => Promise.reject(new Error('storage down')) },
    );
    expect(await processRun(RUN, d)).toBe('failed');
  });
});
