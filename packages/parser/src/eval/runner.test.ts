import type { ParseDraft } from '@synkd/shared';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { completion, jsonResponse, PNG_BYTES, SAMPLE_DRAFT, TEST_PROMPT } from '../testing';
import { EvalResult, resultFileName } from './results';
import { loadSamples, mapPool, runEval } from './runner';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'wf-run-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** A PNG whose bytes end with `marker`, so the fake fetch can tell samples apart. */
const png = (marker: number) => new Uint8Array([...PNG_BYTES, marker]);
const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');

async function addSample(
  rel: string,
  bytes: Uint8Array,
  expected: ParseDraft | string = SAMPLE_DRAFT,
) {
  await mkdir(join(dir, rel, '..'), { recursive: true });
  await writeFile(join(dir, rel), bytes);
  const expectedPath = join(dir, rel.replace(/\.[^.]+$/, '.expected.json'));
  await writeFile(expectedPath, typeof expected === 'string' ? expected : JSON.stringify(expected));
}

type Behaviour = 'ok' | 'schema_invalid' | 'http_500' | 'hang';

/** Answers each sample (found by its marker byte) with the given behaviour. */
function scriptedFetch(byMarker: Record<number, Behaviour>) {
  let calls = 0;
  let inFlight = 0;
  let maxInFlight = 0;
  const fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    calls++;
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      const body = String(init?.body);
      const marker = Number(
        Object.keys(byMarker).find((m) => body.includes(base64(png(Number(m))))),
      );
      await new Promise((r) => setTimeout(r, 5));
      switch (byMarker[marker]) {
        case 'ok':
          return jsonResponse(
            completion(JSON.stringify(SAMPLE_DRAFT), {
              cost: 0.002,
              prompt_tokens: 1000,
              completion_tokens: 100,
            }),
          );
        case 'schema_invalid':
          return jsonResponse(
            completion(JSON.stringify({ events: [{ title: 'Sneaky', start: 'noon' }] })),
          );
        case 'http_500':
          return jsonResponse({ error: { code: 500, message: 'Internal Server Error' } }, 500);
        default:
          return await new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError')),
            );
          });
      }
    } finally {
      inFlight--;
    }
  }) as typeof globalThis.fetch;
  return { fetch, stats: () => ({ calls, maxInFlight }) };
}

const config = (extra: Partial<Parameters<typeof runEval>[0]> = {}) => ({
  model: 'test/model',
  prompt: TEST_PROMPT,
  samplesDir: dir,
  timeoutMs: 50,
  ...extra,
});

describe('runEval', () => {
  it('scores every sample and records failures, skips, cost and latency', async () => {
    await addSample('uni/ok.png', png(1));
    await addSample('uni/invalid.png', png(2));
    await addSample('roster/error.png', png(3));
    await addSample('roster/slow.png', png(4));
    await addSample('photo.heic', new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70]));
    const { fetch, stats } = scriptedFetch({
      1: 'ok',
      2: 'schema_invalid',
      3: 'http_500',
      4: 'hang',
    });
    const progress: number[] = [];

    const result = await runEval(config(), {
      apiKey: 'k',
      fetch,
      clock: () => new Date('2026-09-30T12:00:00.000Z'),
      onProgress: (done) => progress.push(done),
    });

    expect(stats().calls).toBe(4); // the HEIC file is never sent
    expect(progress).toEqual([1, 2, 3, 4, 5]);
    const byId = Object.fromEntries(result.samples.map((s) => [s.id, s]));
    expect(byId['uni/ok']).toMatchObject({
      status: 'ok',
      error: null,
      group: 'uni',
      score: { edits: { total: 0 } },
    });
    expect(byId['uni/invalid']).toMatchObject({
      status: 'failed',
      error: { kind: 'schema_invalid' },
    });
    expect(byId['roster/error']).toMatchObject({
      status: 'failed',
      error: { kind: 'http', status: 500 },
    });
    expect(byId['roster/slow']).toMatchObject({ status: 'failed', error: { kind: 'timeout' } });
    expect(byId.photo).toMatchObject({
      status: 'skipped',
      error: { kind: 'unsupported_format' },
      score: null,
    });
    // Failed parses are scored as empty drafts: one event to add.
    expect(byId['uni/invalid']!.score?.edits.total).toBe(1);

    const { summary } = result;
    expect(summary.samples).toEqual({ total: 5, ok: 1, failed: 3, skipped: 1 });
    expect(summary.failuresByKind).toEqual({
      schema_invalid: 1,
      http: 1,
      timeout: 1,
      unsupported_format: 1,
    });
    expect(summary.scores.samples).toBe(4);
    expect(summary.scores.acceptance).toBe(1); // every failure here is still ≤ 3 edits
    expect(summary.scores.events.recall).toBe(0.25);
    expect(summary.cost).toMatchObject({ maxUsd: 0.002, reported: 2 });
    expect(summary.cost.totalUsd).toBeCloseTo(0.0032, 10);
    expect(summary.cost.meanUsd).toBeCloseTo(0.0016, 10);
    expect(summary.latency.p95Ms).not.toBeNull();
    expect(Object.keys(summary.byGroup)).toEqual(['roster', 'uni']);
    expect(summary.byGroup.uni).toEqual({ samples: 2, acceptance: 1, f1: 2 / 3 });
  });

  it('writes a result that matches the result-file schema and holds no titles by default', async () => {
    await addSample('ok.png', png(1));
    const { fetch } = scriptedFetch({ 1: 'ok' });
    const result = await runEval(config(), {
      apiKey: 'k',
      fetch,
      clock: () => new Date('2026-09-30T12:00:00Z'),
    });

    const roundTrip = EvalResult.parse(JSON.parse(JSON.stringify(result)));
    expect(roundTrip.formatVersion).toBe(1);
    expect(roundTrip.createdAt).toBe('2026-09-30T12:00:00.000Z');
    expect(roundTrip.run).toEqual({
      model: 'test/model',
      promptVersion: TEST_PROMPT.version,
      promptSha256: TEST_PROMPT.sha256,
      concurrency: 4,
      timeoutMs: 50,
      pdfEngine: null,
      zdr: true,
      strictSchema: false,
      keepOutput: false,
    });
    expect(Object.keys(roundTrip.samples[0]!).sort()).toEqual(
      [
        'error',
        'fileBytes',
        'fileType',
        'finishReason',
        'generationId',
        'group',
        'id',
        'latencyMs',
        'provider',
        'score',
        'servedModel',
        'status',
        'usage',
      ].sort(),
    );
    expect(JSON.stringify(result)).not.toContain(SAMPLE_DRAFT.events[0]!.title);
  });

  it('keeps the model output only when asked', async () => {
    await addSample('ok.png', png(1));
    const { fetch } = scriptedFetch({ 1: 'ok' });
    const result = await runEval(config({ keepOutput: true }), { apiKey: 'k', fetch });
    expect(result.samples[0]!.output).toEqual(SAMPLE_DRAFT);
    expect(result.run.keepOutput).toBe(true);
  });

  it('never has more requests in flight than the concurrency limit', async () => {
    for (let i = 1; i <= 6; i++) await addSample(`s${i}.png`, png(i));
    const { fetch, stats } = scriptedFetch({
      1: 'ok',
      2: 'ok',
      3: 'ok',
      4: 'ok',
      5: 'ok',
      6: 'ok',
    });
    await runEval(config({ concurrency: 2 }), { apiKey: 'k', fetch });
    expect(stats()).toEqual({ calls: 6, maxInFlight: 2 });
  });

  it('checks the whole eval set before spending anything', async () => {
    await addSample('good.png', png(1));
    await addSample('bad-expected.png', png(2), '{"events": [{"title": "x"}]}');
    await addSample('not-a-png.png', new TextEncoder().encode('%PDF-1.4'));
    await writeFile(join(dir, 'lonely.jpg'), png(3));
    const { fetch, stats } = scriptedFetch({ 1: 'ok' });
    const err = await runEval(config(), { apiKey: 'k', fetch }).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    const message = (err as Error).message;
    expect(message).toContain('bad-expected.expected.json');
    expect(message).toContain("not-a-png: file contents don't look like .png");
    expect(message).toContain('lonely: no .expected.json file');
    expect(stats().calls).toBe(0);
  });

  it('fails clearly on an empty samples folder', async () => {
    await expect(loadSamples(dir)).rejects.toThrow(/No samples found/);
  });
});

describe('mapPool', () => {
  it('keeps input order', async () => {
    const out = await mapPool([30, 10, 20], 3, async (ms) => {
      await new Promise((r) => setTimeout(r, ms));
      return ms;
    });
    expect(out).toEqual([30, 10, 20]);
  });

  it('handles an empty list', async () => {
    expect(await mapPool([], 4, async (x) => x)).toEqual([]);
  });
});

describe('resultFileName', () => {
  it('is sortable by time and safe for any model id', () => {
    expect(
      resultFileName(new Date('2026-09-30T17:38:05.123Z'), 'google/gemini-2.5-flash:free', 'v1'),
    ).toBe('2026-09-30T17-38-05Z-google_gemini-2.5-flash_free-v1.json');
  });
});
