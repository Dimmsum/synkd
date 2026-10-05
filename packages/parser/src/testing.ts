// Test helpers: a fake OpenRouter. Never makes a network call. Not exported from the package.
import type { ParseDraft } from '@synkd/shared';
import { makePrompt } from './prompt';

export const TEST_PROMPT = makePrompt('v0-test', 'Extract the schedule.');
export const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
]);
export const PDF_BYTES = new TextEncoder().encode('%PDF-1.4\n%fake\n');

export const SAMPLE_DRAFT: ParseDraft = {
  events: [
    {
      title: 'Synthetic Studies',
      category: 'class',
      start: '09:00',
      end: '10:00',
      when: { kind: 'weekly', days: ['mon', 'wed'], pattern: { type: 'every' } },
      confidence: 0.9,
    },
  ],
};

/** A chat completion as OpenRouter returns it, with `content` as the model's text. */
export function completion(
  content: string | null,
  usage = { cost: 0.0012, prompt_tokens: 1500, completion_tokens: 200 },
) {
  return {
    id: 'gen-test-1',
    model: 'test/model',
    provider: 'TestProvider',
    object: 'chat.completion',
    choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }],
    usage: { ...usage, total_tokens: usage.prompt_tokens + usage.completion_tokens },
  };
}

export const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** A fetch that answers every call with `respond`, recording each request. */
export function fakeFetch(
  respond: (body: Record<string, unknown>) => Response | Promise<Response>,
) {
  const calls: { url: string; init: RequestInit; body: Record<string, unknown> }[] = [];
  const fn = async (input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push({ url: String(input), init: init ?? {}, body });
    return respond(body);
  };
  return { fetch: fn as typeof globalThis.fetch, calls };
}

/** A fetch that never answers until its signal aborts, like a hung provider. */
export const hangingFetch = (async (_input: string | URL | Request, init?: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () =>
      reject(new DOMException('aborted', 'AbortError')),
    );
  })) as typeof globalThis.fetch;
