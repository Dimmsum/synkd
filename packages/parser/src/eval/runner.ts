// Runs one model and one prompt over every eval sample and scores the results (WF-022).
// Nothing here prints; the CLI decides what to show, and only aggregate numbers (NFR-SEC-11).
import type { ParseDraft } from '@synkd/shared';
import { readFile } from 'node:fs/promises';
import { matchesMagicBytes, modelMediaType } from '../media';
import {
  DEFAULT_TIMEOUT_MS,
  parseSchedule,
  type OpenRouterOptions,
  type PdfEngine,
} from '../openrouter';
import type { Prompt } from '../prompt';
import { EvalResult, RESULT_FORMAT_VERSION, type RunSummary, type SampleResult } from './results';
import { discoverSamples, loadExpected, type SampleRef } from './samples';
import { percentile, scoreSample, summarizeScores, type SampleScore } from './scoring';

export const DEFAULT_CONCURRENCY = 4;

export interface RunConfig {
  model: string;
  prompt: Prompt;
  samplesDir: string;
  concurrency?: number;
  timeoutMs?: number;
  pdfEngine?: PdfEngine;
  zdr?: boolean;
  strictSchema?: boolean;
  /** Store each validated model output in the result file. Off by default: outputs hold titles. */
  keepOutput?: boolean;
}

export interface RunDeps {
  apiKey: string;
  fetch?: typeof globalThis.fetch;
  /** Monotonic clock for latency, in ms. */
  now?: () => number;
  /** Wall clock for `createdAt`. */
  clock?: () => Date;
  /** Called after each sample with counts only. */
  onProgress?: (done: number, total: number) => void;
}

interface LoadedSample {
  ref: SampleRef;
  expected: ParseDraft;
  bytes: Uint8Array;
}

/**
 * Loads every sample and checks it before any model call, so a typo in one expected file
 * doesn't surface after money has been spent on the rest. Throws with the full list of problems.
 */
export async function loadSamples(samplesDir: string): Promise<LoadedSample[]> {
  const { samples, problems } = await discoverSamples(samplesDir);
  const loaded: LoadedSample[] = [];
  for (const ref of samples) {
    try {
      const expected = await loadExpected(ref.expectedPath);
      const bytes = new Uint8Array(await readFile(ref.filePath));
      const mediaType = modelMediaType(ref.ext);
      if (mediaType && !matchesMagicBytes(bytes, mediaType)) {
        problems.push(`${ref.id}: file contents don't look like .${ref.ext}`);
        continue;
      }
      loaded.push({ ref, expected, bytes });
    } catch (err) {
      problems.push(err instanceof Error ? err.message : String(err));
    }
  }
  if (problems.length > 0) {
    throw new Error(
      `The eval set has problems. Fix them and run again:\n- ${problems.join('\n- ')}`,
    );
  }
  if (loaded.length === 0) throw new Error(`No samples found in ${samplesDir}`);
  return loaded;
}

/** Runs `worker` over `items` with at most `limit` in flight, keeping the input order. */
export async function mapPool<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const lanes = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i]!);
    }
  });
  await Promise.all(lanes);
  return results;
}

async function runSample(
  sample: LoadedSample,
  config: RunConfig,
  opts: OpenRouterOptions,
): Promise<SampleResult> {
  const { ref, expected, bytes } = sample;
  const base = {
    id: ref.id,
    group: ref.group,
    fileType: ref.ext,
    fileBytes: bytes.byteLength,
  };
  const mediaType = modelMediaType(ref.ext);
  if (!mediaType) {
    return {
      ...base,
      status: 'skipped',
      error: { kind: 'unsupported_format', message: `.${ref.ext} must be converted to JPEG first` },
      latencyMs: null,
      usage: null,
      generationId: null,
      servedModel: null,
      provider: null,
      finishReason: null,
      score: null,
    };
  }

  const result = await parseSchedule(
    {
      model: config.model,
      prompt: config.prompt,
      // Only the extension goes to OpenRouter, not the sample's name.
      file: { bytes, mediaType, filename: `schedule.${ref.ext}` },
    },
    opts,
  );
  const score: SampleScore = scoreSample(result.ok ? result.draft : null, expected);
  return {
    ...base,
    status: result.ok ? 'ok' : 'failed',
    error: result.ok ? null : result.error,
    latencyMs: Math.round(result.meta.latencyMs),
    usage: result.meta.usage,
    generationId: result.meta.generationId,
    servedModel: result.meta.servedModel,
    provider: result.meta.provider,
    finishReason: result.meta.finishReason,
    score,
    ...(result.ok && config.keepOutput ? { output: result.draft } : {}),
  };
}

export function summarizeRun(samples: readonly SampleResult[]): RunSummary {
  const attempted = samples.filter((s) => s.status !== 'skipped');
  const scores = attempted.flatMap((s) => (s.score ? [s.score] : []));
  const failuresByKind: Record<string, number> = {};
  for (const s of samples) {
    if (s.error) failuresByKind[s.error.kind] = (failuresByKind[s.error.kind] ?? 0) + 1;
  }
  const costs = attempted.flatMap((s) => (s.usage?.costUsd != null ? [s.usage.costUsd] : []));
  const latencies = attempted.flatMap((s) => (s.latencyMs != null ? [s.latencyMs] : []));
  const totalUsd = costs.reduce((a, b) => a + b, 0);

  const groups = new Map<string, SampleScore[]>();
  for (const s of attempted) {
    if (!s.score) continue;
    const key = s.group ?? '(top level)';
    groups.set(key, [...(groups.get(key) ?? []), s.score]);
  }
  const byGroup: RunSummary['byGroup'] = {};
  for (const [key, groupScores] of [...groups].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const summary = summarizeScores(groupScores);
    byGroup[key] = {
      samples: summary.samples,
      acceptance: summary.acceptance,
      f1: summary.events.f1,
    };
  }

  return {
    samples: {
      total: samples.length,
      ok: samples.filter((s) => s.status === 'ok').length,
      failed: samples.filter((s) => s.status === 'failed').length,
      skipped: samples.filter((s) => s.status === 'skipped').length,
    },
    failuresByKind,
    scores: summarizeScores(scores),
    cost: {
      totalUsd,
      meanUsd: costs.length === 0 ? null : totalUsd / costs.length,
      maxUsd: costs.length === 0 ? null : Math.max(...costs),
      reported: costs.length,
    },
    latency: {
      meanMs:
        latencies.length === 0 ? null : latencies.reduce((a, b) => a + b, 0) / latencies.length,
      p50Ms: percentile(latencies, 50),
      p95Ms: percentile(latencies, 95),
      maxMs: latencies.length === 0 ? null : Math.max(...latencies),
    },
    byGroup,
  };
}

export async function runEval(config: RunConfig, deps: RunDeps): Promise<EvalResult> {
  const createdAt = (deps.clock ?? (() => new Date()))();
  const samples = await loadSamples(config.samplesDir);
  const concurrency = config.concurrency ?? DEFAULT_CONCURRENCY;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const opts: OpenRouterOptions = {
    apiKey: deps.apiKey,
    timeoutMs,
    zdr: config.zdr ?? true,
    strictSchema: config.strictSchema ?? false,
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
    ...(deps.now ? { now: deps.now } : {}),
    ...(config.pdfEngine ? { pdfEngine: config.pdfEngine } : {}),
  };

  let done = 0;
  const results = await mapPool(samples, concurrency, async (sample) => {
    const result = await runSample(sample, config, opts);
    deps.onProgress?.(++done, samples.length);
    return result;
  });

  // Parsing our own output catches a result shape that drifted from the schema `compare` reads.
  return EvalResult.parse({
    formatVersion: RESULT_FORMAT_VERSION,
    createdAt: createdAt.toISOString(),
    run: {
      model: config.model,
      promptVersion: config.prompt.version,
      promptSha256: config.prompt.sha256,
      concurrency,
      timeoutMs,
      pdfEngine: config.pdfEngine ?? null,
      zdr: opts.zdr ?? true,
      strictSchema: opts.strictSchema ?? false,
      keepOutput: config.keepOutput ?? false,
    },
    summary: summarizeRun(results),
    samples: results,
  });
}
