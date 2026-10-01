// The production parse (WF-027, WF-028, PRD §8.5, D46): the images of one schedule file in, a
// validated, scrubbed `ParseDraft` out, or a typed failure that says whether another attempt
// could help. One model call per run: retries go back through the job queue with backoff, so
// no single server invocation carries several LLM calls (spike §7).
//
// Model choice: PARSE_MODEL_PRIMARY with PARSE_MODEL_FALLBACK as OpenRouter's fallback
// (`models` routing). Retries alternate which one goes first, so a model that keeps returning
// invalid output doesn't use up every attempt.
//
// Privacy: the images go only to zero-data-retention providers (NFR-SEC-8, via
// openrouter.ts). Nothing from the images or the model's output is returned in an error or
// logged (NFR-SEC-11). Titles are scrubbed of rooms, names and IDs (D35, scrub.ts).
import {
  DAYS_OF_WEEK,
  PARSE_MODEL_FALLBACK,
  PARSE_MODEL_PRIMARY,
  PARSER_VERSION,
  SCHEDULE_MAX_EXCEPTIONS,
  SCHEDULE_PERIOD_MAX_DAYS,
  type EventDraft,
  type ParseDraft,
  type ParseErrorCode,
} from '@whosfree/shared';
import { parseSchedule, type ParseErrorKind, type ScheduleFile } from './openrouter';
import { PRODUCTION_PROMPT, type Prompt } from './prompt-core';
import { scrubDraft } from './scrub';

export interface ParseImagesInput {
  /** JPEG pages of one schedule, in order (convertUpload's output). */
  images: readonly { bytes: Uint8Array }[];
  apiKey: string;
  /** 1-based run number of the job; decides which model goes first. */
  attempt: number;
  models?: { primary: string; fallback: string };
  prompt?: Prompt;
  /** Today's date (`YYYY-MM-DD`) where the person is, for date ranges that show no year. */
  today?: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

interface ParseOutcomeBase {
  /** The model that answered (or was asked first, if none did). */
  model: string;
  /** What OpenRouter charged for this run, in USD; null if it didn't say. */
  costUsd: number | null;
  parserVersion: string;
}

export type ParseOutcome =
  | (ParseOutcomeBase & {
      ok: true;
      draft: ParseDraft;
      /** Mean of the events' confidence, 0–1 (PRD §9 `parseJobs.confidence`). */
      confidence: number;
    })
  | (ParseOutcomeBase & {
      ok: false;
      code: Extract<ParseErrorCode, 'no_schedule_found' | 'parse_failed'>;
      /** True when another run might succeed (provider trouble, invalid output). */
      retryable: boolean;
      /** What went wrong, for logs: a kind and an HTTP status, never content (NFR-SEC-11). */
      kind: ParseErrorKind | 'no_events';
      status?: number;
    });

/** HTTP statuses worth another attempt later: timeouts, conflicts, rate limits, credits, 5xx. */
export function isRetryableStatus(status: number | undefined): boolean {
  if (status === undefined) return true;
  return (
    status === 402 ||
    status === 408 ||
    status === 409 ||
    status === 425 ||
    status === 429 ||
    status >= 500
  );
}

/** Odd runs try the primary model first, even runs the fallback. */
export function modelOrder(
  attempt: number,
  models = { primary: PARSE_MODEL_PRIMARY, fallback: PARSE_MODEL_FALLBACK },
): [string, string] {
  return attempt % 2 === 0 ? [models.fallback, models.primary] : [models.primary, models.fallback];
}

const dayIndex = (d: string) => DAYS_OF_WEEK.indexOf(d as (typeof DAYS_OF_WEEK)[number]);

function sortKey(e: EventDraft): string {
  const first =
    e.when.kind === 'weekly' ? `w${Math.min(...e.when.days.map(dayIndex))}` : `d${e.when.date}`;
  return `${first} ${e.start} ${e.title}`;
}

const daysBetween = (start: string, end: string) =>
  (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000 + 1;

/**
 * Normalises a validated draft (PRD §8.5 step 4): scrubs titles (D35), drops exact
 * duplicates (an event repeated on two pages), orders events by day and time, and drops a
 * suggested period the review screen couldn't accept anyway (over SCHEDULE_PERIOD_MAX_DAYS),
 * keeping at most SCHEDULE_MAX_EXCEPTIONS exceptions.
 */
export function normaliseDraft(draft: ParseDraft): ParseDraft {
  const scrubbed = scrubDraft(draft);
  const seen = new Set<string>();
  const events = scrubbed.events
    .filter((e) => {
      const key = JSON.stringify([e.title.toLowerCase(), e.category, e.start, e.end, e.when]);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  const period = scrubbed.suggestedPeriod;
  const usable = period && daysBetween(period.start, period.end) <= SCHEDULE_PERIOD_MAX_DAYS;
  return {
    events,
    ...(usable
      ? {
          suggestedPeriod: {
            ...period,
            exceptions: period.exceptions.slice(0, SCHEDULE_MAX_EXCEPTIONS),
          },
        }
      : {}),
  };
}

/** One parse run over the images of one file. Never throws for model or network problems. */
export async function parseScheduleImages(input: ParseImagesInput): Promise<ParseOutcome> {
  const [first, second] = modelOrder(input.attempt, input.models);
  const files: ScheduleFile[] = input.images.map((image, i) => ({
    bytes: image.bytes,
    mediaType: 'image/jpeg',
    filename: `page-${i + 1}.jpg`,
  }));
  const result = await parseSchedule(
    {
      file: files,
      model: first,
      fallbackModels: [second],
      prompt: input.prompt ?? PRODUCTION_PROMPT,
      ...(input.today ? { today: input.today } : {}),
    },
    {
      apiKey: input.apiKey,
      ...(input.fetch ? { fetch: input.fetch } : {}),
      ...(input.timeoutMs ? { timeoutMs: input.timeoutMs } : {}),
    },
  );
  const base: ParseOutcomeBase = {
    model: result.meta.servedModel ?? first,
    costUsd: result.meta.usage?.costUsd ?? null,
    parserVersion: PARSER_VERSION,
  };
  if (!result.ok) {
    const { kind, status } = result.error;
    return {
      ...base,
      ok: false,
      code: 'parse_failed',
      retryable: kind === 'http' ? isRetryableStatus(status) : true,
      kind,
      ...(status !== undefined ? { status } : {}),
    };
  }
  const draft = normaliseDraft(result.draft);
  if (draft.events.length === 0) {
    return { ...base, ok: false, code: 'no_schedule_found', retryable: false, kind: 'no_events' };
  }
  const confidence = draft.events.reduce((sum, e) => sum + e.confidence, 0) / draft.events.length;
  return { ...base, ok: true, draft, confidence: Math.round(confidence * 1000) / 1000 };
}
