// Parse one schedule file with one model and one prompt through OpenRouter (D15).
//
// Deliberately small: one request, no retries or caching. The production pipeline (parse.ts)
// adds those through the job queue (WF-027, NFR-REL-2, D46); OpenRouter's own fallback models
// are passed with `fallbackModels`. The API key is passed in by the caller and never read from
// the environment here, so importing this module can't leak it. Only the Next.js server and the
// eval CLI hold the key (NFR-SEC-8). Nothing from the file or the model output is logged
// (NFR-SEC-11).
import { ParseDraft } from '@synkd/shared';
import { z } from 'zod';
import type { ModelMediaType } from './media';
import type { Prompt } from './prompt-core';

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
export const DEFAULT_TIMEOUT_MS = 120_000;

/** How OpenRouter turns a PDF into model input. `native` sends it to models that read PDFs. */
export const PDF_ENGINES = ['native', 'mistral-ocr', 'cloudflare-ai'] as const;
export type PdfEngine = (typeof PDF_ENGINES)[number];

export interface ScheduleFile {
  bytes: Uint8Array;
  mediaType: ModelMediaType;
  /** Sent to OpenRouter for PDFs. Use a neutral name; it isn't needed for anything else. */
  filename: string;
}

export interface ParseRequest {
  /** One file, or the pages of one schedule (at most SCHEDULE_FILE_MAX_PDF_PAGES images). */
  file: ScheduleFile | readonly ScheduleFile[];
  /** An OpenRouter model id, e.g. `google/gemini-2.5-flash`. */
  model: string;
  /**
   * Models OpenRouter tries, in order, when `model` fails (provider errors, rate limits,
   * refusals): its `models` routing parameter. The response says which one answered.
   */
  fallbackModels?: readonly string[];
  prompt: Prompt;
  /**
   * Today's date (`YYYY-MM-DD`), sent with the instruction so the model can give a date range
   * that shows no year the right one (prompt v3, rule 8). Not part of the prompt or its hash.
   */
  today?: string;
}

export interface OpenRouterOptions {
  apiKey: string;
  fetch?: typeof globalThis.fetch;
  /** Whole-request timeout, including reading the body. */
  timeoutMs?: number;
  baseUrl?: string;
  pdfEngine?: PdfEngine;
  /**
   * Route only to zero-data-retention endpoints (NFR-SEC-8). On by default. Providers that
   * collect prompt data are always excluded (`data_collection: "deny"`).
   */
  zdr?: boolean;
  /** Ask for strict JSON-schema output. Not every provider honours it; zod validates either way. */
  strictSchema?: boolean;
  /** Monotonic clock in ms, for latency. Injectable for tests. */
  now?: () => number;
}

export interface ParseUsage {
  /** What OpenRouter charged for the request, in USD credits. `null` if it wasn't reported. */
  costUsd: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
}

export const PARSE_ERROR_KINDS = [
  'http',
  'timeout',
  'network',
  'invalid_response',
  'empty_output',
  'invalid_json',
  'schema_invalid',
] as const;
export type ParseErrorKind = (typeof PARSE_ERROR_KINDS)[number];

export interface ParseFailure {
  kind: ParseErrorKind;
  /** Safe to log: never contains model output or file contents. */
  message: string;
  status?: number;
  /** For `schema_invalid`: where the output broke the schema (paths and messages only). */
  issues?: { path: string; message: string }[];
}

export interface ParseMeta {
  latencyMs: number;
  usage: ParseUsage | null;
  generationId: string | null;
  /** The model that actually served the request, as OpenRouter reports it. */
  servedModel: string | null;
  provider: string | null;
  finishReason: string | null;
}

export type ParseResult =
  | { ok: true; draft: ParseDraft; meta: ParseMeta }
  | { ok: false; error: ParseFailure; meta: ParseMeta };

const USER_INSTRUCTION = 'Extract the schedule from the attached file.';
const USER_INSTRUCTION_PAGES =
  'Extract the schedule from the attached pages. They are one schedule.';
const MAX_ERROR_MESSAGE = 200;

/**
 * The JSON schema sent as `response_format`, derived from the shared `ParseDraft` schema so the
 * two can't drift. Date regexes are dropped (`format: "date"` stays): some providers reject long
 * patterns, and zod checks real dates afterwards anyway.
 */
export function modelJsonSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(ParseDraft, { io: 'output', unrepresentable: 'any' });
  const clean = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(clean);
    if (node === null || typeof node !== 'object') return node;
    const out: Record<string, unknown> = {};
    const obj = node as Record<string, unknown>;
    for (const [key, value] of Object.entries(obj)) {
      if (key === '$schema' || key === 'default') continue;
      if (key === 'pattern' && obj.format === 'date') continue;
      out[key] = clean(value);
    }
    return out;
  };
  return clean(schema) as Record<string, unknown>;
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
}

/** The chat-completions request body. Exported for tests. */
export function buildRequestBody(
  req: ParseRequest,
  opts: Pick<OpenRouterOptions, 'pdfEngine' | 'zdr' | 'strictSchema'> = {},
): Record<string, unknown> {
  const files: readonly ScheduleFile[] = Array.isArray(req.file)
    ? req.file
    : [req.file as ScheduleFile];
  const fileParts = files.map((file) => {
    const dataUrl = `data:${file.mediaType};base64,${toBase64(file.bytes)}`;
    return file.mediaType === 'application/pdf'
      ? { type: 'file', file: { filename: file.filename, file_data: dataUrl } }
      : { type: 'image_url', image_url: { url: dataUrl } };
  });
  const base = files.length > 1 ? USER_INSTRUCTION_PAGES : USER_INSTRUCTION;
  const instruction = req.today ? `${base} Today's date is ${req.today}.` : base;
  const body: Record<string, unknown> = {
    model: req.model,
    ...(req.fallbackModels?.length ? { models: [req.model, ...req.fallbackModels] } : {}),
    temperature: 0,
    messages: [
      { role: 'system', content: req.prompt.text },
      { role: 'user', content: [{ type: 'text', text: instruction }, ...fileParts] },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'parse_draft',
        strict: opts.strictSchema ?? false,
        schema: modelJsonSchema(),
      },
    },
    // NFR-SEC-8: never route to providers that store or train on prompts. `require_parameters`
    // keeps requests off endpoints that would silently ignore `response_format`.
    provider: { data_collection: 'deny', zdr: opts.zdr ?? true, require_parameters: true },
  };
  if (files.some((f) => f.mediaType === 'application/pdf') && opts.pdfEngine) {
    body.plugins = [{ id: 'file-parser', pdf: { engine: opts.pdfEngine } }];
  }
  return body;
}

// Only the fields we read. OpenRouter includes `usage` (with `cost`) on every response.
const CompletionResponse = z.object({
  id: z.string().optional(),
  model: z.string().optional(),
  provider: z.string().optional(),
  choices: z
    .array(
      z.object({
        finish_reason: z.string().nullish(),
        message: z
          .object({
            content: z
              .union([
                z.string(),
                z.array(z.object({ type: z.string(), text: z.string().optional() })),
              ])
              .nullish(),
          })
          .optional(),
      }),
    )
    .optional(),
  usage: z
    .object({
      cost: z.number().nullish(),
      prompt_tokens: z.number().nullish(),
      completion_tokens: z.number().nullish(),
    })
    .optional(),
  error: z
    .object({ code: z.union([z.number(), z.string()]).optional(), message: z.string().optional() })
    .optional(),
});

function truncate(text: string): string {
  return text.length > MAX_ERROR_MESSAGE ? `${text.slice(0, MAX_ERROR_MESSAGE)}…` : text;
}

/** Removes a Markdown code fence some models wrap JSON in despite being told not to. */
export function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const match = /^```[a-zA-Z]*\s*\n([\s\S]*?)\n?```$/.exec(trimmed);
  return match?.[1] ?? trimmed;
}

function issuePath(path: readonly PropertyKey[]): string {
  return path.map((p) => (typeof p === 'number' ? `[${p}]` : `.${String(p)}`)).join('') || '(root)';
}

/**
 * Sends one file to one model and validates the answer against `ParseDraft`.
 *
 * Never throws for request or output problems: those come back as `{ ok: false }` with a
 * `kind`, so a batch run can record them and carry on. Unknown keys in the output (such as
 * `location` or `room`) are stripped by zod (D35).
 */
export async function parseSchedule(
  req: ParseRequest,
  opts: OpenRouterOptions,
): Promise<ParseResult> {
  const fetchFn = opts.fetch ?? globalThis.fetch;
  const now = opts.now ?? (() => performance.now());
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = now();
  const meta: ParseMeta = {
    latencyMs: 0,
    usage: null,
    generationId: null,
    servedModel: null,
    provider: null,
    finishReason: null,
  };
  const fail = (error: ParseFailure): ParseResult => ({ ok: false, error, meta });

  let status: number;
  let rawBody: string;
  try {
    const res = await fetchFn(`${opts.baseUrl ?? OPENROUTER_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        'Content-Type': 'application/json',
        'X-Title': 'synkd parser',
      },
      body: JSON.stringify(buildRequestBody(req, opts)),
      signal: controller.signal,
    });
    status = res.status;
    rawBody = await res.text();
  } catch (err) {
    meta.latencyMs = now() - started;
    if (controller.signal.aborted) {
      return fail({ kind: 'timeout', message: `No response within ${timeoutMs} ms` });
    }
    const name = err instanceof Error ? err.name : 'Error';
    return fail({ kind: 'network', message: truncate(`Request failed (${name})`) });
  } finally {
    clearTimeout(timer);
  }
  meta.latencyMs = now() - started;

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    json = undefined;
  }
  const parsed = CompletionResponse.safeParse(json);
  const response = parsed.success ? parsed.data : undefined;
  if (response) {
    meta.generationId = response.id ?? null;
    meta.servedModel = response.model ?? null;
    meta.provider = response.provider ?? null;
    meta.finishReason = response.choices?.[0]?.finish_reason ?? null;
    if (response.usage) {
      meta.usage = {
        costUsd: response.usage.cost ?? null,
        promptTokens: response.usage.prompt_tokens ?? null,
        completionTokens: response.usage.completion_tokens ?? null,
      };
    }
  }

  // OpenRouter reports some provider failures as a 200 with an `error` object.
  if (status < 200 || status >= 300 || response?.error) {
    const code = response?.error?.code;
    return fail({
      kind: 'http',
      status: typeof code === 'number' ? code : status,
      message: truncate(
        `OpenRouter error ${typeof code === 'undefined' ? status : code}: ${response?.error?.message ?? 'no message'}`,
      ),
    });
  }
  if (!response) {
    return fail({ kind: 'invalid_response', message: 'Response is not a chat completion' });
  }

  const content = response.choices?.[0]?.message?.content;
  const text =
    typeof content === 'string' ? content : (content ?? []).map((part) => part.text ?? '').join('');
  if (text.trim() === '') {
    return fail({
      kind: 'empty_output',
      message: `Model returned no content (finish reason: ${meta.finishReason ?? 'unknown'})`,
    });
  }

  let output: unknown;
  try {
    output = JSON.parse(stripCodeFence(text));
  } catch {
    return fail({ kind: 'invalid_json', message: 'Model output is not valid JSON' });
  }

  const draft = ParseDraft.safeParse(output);
  if (!draft.success) {
    const issues = draft.error.issues.map((i) => ({ path: issuePath(i.path), message: i.message }));
    return fail({
      kind: 'schema_invalid',
      message: `Model output failed the ParseDraft schema (${issues.length} issue${issues.length === 1 ? '' : 's'})`,
      issues: issues.slice(0, 20),
    });
  }
  return { ok: true, draft: draft.data, meta };
}
