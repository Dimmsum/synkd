import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildRequestBody, modelJsonSchema, parseSchedule, stripCodeFence } from './openrouter';
import {
  completion,
  fakeFetch,
  hangingFetch,
  jsonResponse,
  PDF_BYTES,
  PNG_BYTES,
  SAMPLE_DRAFT,
  TEST_PROMPT,
} from './testing';

const png = { bytes: PNG_BYTES, mediaType: 'image/png' as const, filename: 'schedule.png' };
const req = { file: png, model: 'test/model', prompt: TEST_PROMPT };

describe('API key handling (NFR-SEC-8)', () => {
  it('reads the environment only in the eval CLI, never in library code', async () => {
    const root = fileURLToPath(new URL('./', import.meta.url));
    const files = (await readdir(root, { recursive: true })).filter(
      (f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== join('eval', 'cli.ts'),
    );
    expect(files.length).toBeGreaterThan(5);
    for (const file of files) {
      expect(await readFile(join(root, file), 'utf8'), file).not.toMatch(
        /process\.env|OPENROUTER_API_KEY/,
      );
    }
  });
});

describe('buildRequestBody', () => {
  it('sends images as a data URL with the prompt as the system message', () => {
    const body = buildRequestBody(req) as {
      model: string;
      messages: { role: string; content: unknown }[];
      provider: Record<string, unknown>;
      plugins?: unknown;
    };
    expect(body.model).toBe('test/model');
    expect(body.messages[0]).toEqual({ role: 'system', content: TEST_PROMPT.text });
    expect(JSON.stringify(body.messages[1])).toContain(
      '"image_url":{"url":"data:image/png;base64,',
    );
    expect(body.plugins).toBeUndefined();
  });

  it('never routes to providers that collect data, and ZDR is on by default (NFR-SEC-8)', () => {
    expect(buildRequestBody(req).provider).toEqual({
      data_collection: 'deny',
      zdr: true,
      require_parameters: true,
    });
    expect(buildRequestBody(req, { zdr: false }).provider).toMatchObject({
      data_collection: 'deny',
      zdr: false,
    });
  });

  it('sends PDFs as a file part, with the chosen PDF engine', () => {
    const pdf = {
      bytes: PDF_BYTES,
      mediaType: 'application/pdf' as const,
      filename: 'schedule.pdf',
    };
    const body = buildRequestBody({ ...req, file: pdf }, { pdfEngine: 'native' });
    expect(JSON.stringify(body.messages)).toContain(
      '"file":{"filename":"schedule.pdf","file_data":"data:application/pdf;base64,',
    );
    expect(body.plugins).toEqual([{ id: 'file-parser', pdf: { engine: 'native' } }]);
  });

  it('asks for JSON-schema output, non-strict unless requested', () => {
    expect(buildRequestBody(req).response_format).toMatchObject({
      type: 'json_schema',
      json_schema: { name: 'parse_draft', strict: false },
    });
    expect(buildRequestBody(req, { strictSchema: true }).response_format).toMatchObject({
      json_schema: { strict: true },
    });
  });
});

describe('modelJsonSchema', () => {
  it('has no location-like fields and no draft marker or date regexes (D35)', () => {
    const text = JSON.stringify(modelJsonSchema());
    expect(text).not.toMatch(/location|room|address/i);
    expect(text).not.toContain('$schema');
    expect(text).toContain('"format":"date"');
    expect(text).not.toContain('02-29'); // the long leap-year date pattern is dropped
  });
});

describe('stripCodeFence', () => {
  it('removes a json fence and leaves plain text alone', () => {
    expect(stripCodeFence('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(stripCodeFence('  {"a":1} ')).toBe('{"a":1}');
  });
});

describe('parseSchedule', () => {
  let clock = 0;
  const now = () => (clock += 500);

  it('returns the validated draft with cost, tokens and latency', async () => {
    const { fetch, calls } = fakeFetch(() =>
      jsonResponse(completion(JSON.stringify(SAMPLE_DRAFT))),
    );
    const result = await parseSchedule(req, { apiKey: 'sk-test', fetch, now });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft).toEqual(SAMPLE_DRAFT);
    expect(result.meta).toMatchObject({
      latencyMs: 500,
      usage: { costUsd: 0.0012, promptTokens: 1500, completionTokens: 200 },
      generationId: 'gen-test-1',
      servedModel: 'test/model',
      provider: 'TestProvider',
      finishReason: 'stop',
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(new Headers(calls[0]!.init.headers).get('Authorization')).toBe('Bearer sk-test');
  });

  it('strips location, room and other unknown fields from the output (D35)', async () => {
    const withLocation = {
      events: SAMPLE_DRAFT.events.map((e) => ({
        ...e,
        location: 'Room 12',
        room: 'SLT 2',
        address: '1 Main St',
      })),
      location: 'Campus',
    };
    const { fetch } = fakeFetch(() => jsonResponse(completion(JSON.stringify(withLocation))));
    const result = await parseSchedule(req, { apiKey: 'k', fetch });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft).toEqual(SAMPLE_DRAFT);
    expect(JSON.stringify(result.draft)).not.toMatch(/location|room|address|Main St|SLT/i);
  });

  it('accepts output wrapped in a code fence or given as content parts', async () => {
    const fenced = fakeFetch(() =>
      jsonResponse(completion(`\`\`\`json\n${JSON.stringify(SAMPLE_DRAFT)}\n\`\`\``)),
    );
    expect((await parseSchedule(req, { apiKey: 'k', fetch: fenced.fetch })).ok).toBe(true);

    const parts = completion(null);
    (parts.choices[0]!.message as { content: unknown }).content = [
      { type: 'text', text: JSON.stringify(SAMPLE_DRAFT) },
    ];
    const partsFetch = fakeFetch(() => jsonResponse(parts));
    expect((await parseSchedule(req, { apiKey: 'k', fetch: partsFetch.fetch })).ok).toBe(true);
  });

  it('reports schema-invalid output with paths and messages, not the output itself', async () => {
    const bad = {
      events: [
        { ...SAMPLE_DRAFT.events[0], title: 'Secret Class Name', start: '9am', category: 'party' },
      ],
    };
    const { fetch } = fakeFetch(() => jsonResponse(completion(JSON.stringify(bad))));
    const result = await parseSchedule(req, { apiKey: 'k', fetch });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('schema_invalid');
    expect(result.error.issues?.map((i) => i.path)).toEqual(
      expect.arrayContaining(['.events[0].start', '.events[0].category']),
    );
    expect(JSON.stringify(result.error)).not.toContain('Secret Class Name');
    expect(result.meta.usage?.costUsd).toBe(0.0012); // a failed parse still costs money
  });

  it('reports output that is not JSON', async () => {
    const { fetch } = fakeFetch(() =>
      jsonResponse(completion('Here is your schedule: Maths on Monday')),
    );
    const result = await parseSchedule(req, { apiKey: 'k', fetch });
    expect(result).toMatchObject({ ok: false, error: { kind: 'invalid_json' } });
    if (!result.ok) expect(result.error.message).not.toContain('Maths');
  });

  it('reports empty output', async () => {
    const { fetch } = fakeFetch(() => jsonResponse(completion('')));
    const result = await parseSchedule(req, { apiKey: 'k', fetch });
    expect(result).toMatchObject({ ok: false, error: { kind: 'empty_output' } });
  });

  it('reports an HTTP error with its status and message', async () => {
    const { fetch } = fakeFetch(() =>
      jsonResponse({ error: { code: 402, message: 'Insufficient credits' } }, 402),
    );
    const result = await parseSchedule(req, { apiKey: 'k', fetch });
    expect(result).toMatchObject({ ok: false, error: { kind: 'http', status: 402 } });
    if (!result.ok) expect(result.error.message).toContain('Insufficient credits');
  });

  it('reports an HTTP error whose body is not JSON', async () => {
    const { fetch } = fakeFetch(() => new Response('<html>Bad gateway</html>', { status: 502 }));
    const result = await parseSchedule(req, { apiKey: 'k', fetch });
    expect(result).toMatchObject({ ok: false, error: { kind: 'http', status: 502 } });
  });

  it('reports a provider error sent with status 200', async () => {
    const { fetch } = fakeFetch(() =>
      jsonResponse({ error: { code: 503, message: 'Provider unavailable' } }),
    );
    const result = await parseSchedule(req, { apiKey: 'k', fetch });
    expect(result).toMatchObject({ ok: false, error: { kind: 'http', status: 503 } });
  });

  it('reports a 200 that is not a chat completion', async () => {
    const { fetch } = fakeFetch(() => new Response('not json', { status: 200 }));
    const result = await parseSchedule(req, { apiKey: 'k', fetch });
    expect(result).toMatchObject({ ok: false, error: { kind: 'invalid_response' } });
  });

  it('times out a request that never answers', async () => {
    const result = await parseSchedule(req, { apiKey: 'k', fetch: hangingFetch, timeoutMs: 20 });
    expect(result).toMatchObject({ ok: false, error: { kind: 'timeout' } });
    expect(result.meta.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('reports a network failure without the underlying message', async () => {
    const fetch = (async () => {
      throw new TypeError('fetch failed: getaddrinfo ENOTFOUND');
    }) as typeof globalThis.fetch;
    const result = await parseSchedule(req, { apiKey: 'k', fetch });
    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'network', message: 'Request failed (TypeError)' },
    });
  });

  it('never puts the API key in an error', async () => {
    const { fetch } = fakeFetch(() =>
      jsonResponse({ error: { code: 401, message: 'No auth credentials found' } }, 401),
    );
    const result = await parseSchedule(req, { apiKey: 'sk-or-very-secret', fetch });
    expect(JSON.stringify(result)).not.toContain('sk-or-very-secret');
  });
});
