import { PARSE_MODEL_FALLBACK, PARSE_MODEL_PRIMARY, PARSER_VERSION } from '@synkd/shared';
import { describe, expect, it } from 'vitest';
import { isRetryableStatus, modelOrder, normaliseDraft, parseScheduleImages } from './pipeline';
import { SAMPLE_DRAFT, completion, fakeFetch, jsonResponse } from './testing';

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
const run = (fetch: typeof globalThis.fetch, attempt = 1) =>
  parseScheduleImages({ images: [{ bytes: JPEG }, { bytes: JPEG }], apiKey: 'k', attempt, fetch });

describe('modelOrder', () => {
  it('alternates which model goes first between runs', () => {
    expect(modelOrder(1)).toEqual([PARSE_MODEL_PRIMARY, PARSE_MODEL_FALLBACK]);
    expect(modelOrder(2)).toEqual([PARSE_MODEL_FALLBACK, PARSE_MODEL_PRIMARY]);
    expect(modelOrder(3)).toEqual([PARSE_MODEL_PRIMARY, PARSE_MODEL_FALLBACK]);
  });
});

describe('isRetryableStatus', () => {
  it('retries provider trouble but not bad requests or auth', () => {
    for (const s of [402, 408, 429, 500, 502, 503]) expect(isRetryableStatus(s)).toBe(true);
    for (const s of [400, 401, 403, 404, 413, 422]) expect(isRetryableStatus(s)).toBe(false);
  });
});

describe('normaliseDraft', () => {
  const event = SAMPLE_DRAFT.events[0]!;

  it('scrubs titles, drops duplicates and sorts by day then time (D35)', () => {
    const later = { ...event, title: 'B Lecture', start: '13:00', end: '14:00' };
    const roomy = { ...event, title: 'A Lecture - Room 12' };
    const tuesday = {
      ...event,
      title: 'C Lab',
      when: {
        kind: 'weekly' as const,
        days: ['tue' as const],
        pattern: { type: 'every' as const },
      },
    };
    const draft = normaliseDraft({ events: [tuesday, later, roomy, { ...roomy }] });
    expect(draft.events.map((e) => e.title)).toEqual(['A Lecture', 'B Lecture', 'C Lab']);
  });

  it('drops a suggested period longer than a schedule can be', () => {
    const long = normaliseDraft({
      events: [event],
      suggestedPeriod: { start: '2026-01-01', end: '2027-06-30', exceptions: [] },
    });
    expect(long.suggestedPeriod).toBeUndefined();
    const ok = normaliseDraft({
      events: [event],
      suggestedPeriod: { start: '2026-08-31', end: '2026-12-12', exceptions: [] },
    });
    expect(ok.suggestedPeriod?.end).toBe('2026-12-12');
  });
});

describe('parseScheduleImages', () => {
  it('sends every page with the fallback model and returns a scrubbed draft', async () => {
    const draft = {
      events: [{ ...SAMPLE_DRAFT.events[0], title: 'Synthetic Studies (Rm 4)', confidence: 0.6 }],
    };
    const { fetch, calls } = fakeFetch(() => jsonResponse(completion(JSON.stringify(draft))));
    const result = await run(fetch);
    expect(result).toMatchObject({
      ok: true,
      model: 'test/model',
      costUsd: 0.0012,
      parserVersion: PARSER_VERSION,
      confidence: 0.6,
    });
    expect(result.ok && result.draft.events[0]?.title).toBe('Synthetic Studies');
    const body = calls[0]!.body as {
      model: string;
      models: string[];
      messages: { content: unknown }[];
    };
    expect(body.model).toBe(PARSE_MODEL_PRIMARY);
    expect(body.models).toEqual([PARSE_MODEL_PRIMARY, PARSE_MODEL_FALLBACK]);
    const parts = body.messages[1]!.content as { type: string }[];
    expect(parts.filter((p) => p.type === 'image_url')).toHaveLength(2);
  });

  it('starts with the fallback model on even runs', async () => {
    const { fetch, calls } = fakeFetch(() =>
      jsonResponse(completion(JSON.stringify(SAMPLE_DRAFT))),
    );
    await run(fetch, 2);
    expect((calls[0]!.body as { model: string }).model).toBe(PARSE_MODEL_FALLBACK);
  });

  it('reports an empty schedule as not retryable', async () => {
    const { fetch } = fakeFetch(() => jsonResponse(completion('{"events": []}')));
    expect(await run(fetch)).toMatchObject({
      ok: false,
      code: 'no_schedule_found',
      retryable: false,
    });
  });

  it('marks invalid output and provider errors retryable, bad requests not', async () => {
    const invalid = fakeFetch(() => jsonResponse(completion('{"events": [{"title": 1}]}')));
    expect(await run(invalid.fetch)).toMatchObject({
      ok: false,
      code: 'parse_failed',
      retryable: true,
      kind: 'schema_invalid',
    });
    const busy = fakeFetch(() => jsonResponse({ error: { code: 429, message: 'slow down' } }, 429));
    expect(await run(busy.fetch)).toMatchObject({ ok: false, retryable: true, status: 429 });
    const bad = fakeFetch(() => jsonResponse({ error: { code: 400, message: 'bad' } }, 400));
    expect(await run(bad.fetch)).toMatchObject({ ok: false, retryable: false, status: 400 });
  });

  it('never puts model output in a failure (NFR-SEC-11)', async () => {
    const secret = 'COMP1161 with Dr. Secret in Room 99';
    const { fetch } = fakeFetch(() => jsonResponse(completion(`not json: ${secret}`)));
    const result = await run(fetch);
    expect(JSON.stringify(result)).not.toContain('Secret');
  });
});
