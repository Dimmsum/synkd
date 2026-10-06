// The eval result file: one JSON file per run, compared across runs (WF-022, FR-ADM-3).
// Bump RESULT_FORMAT_VERSION when the shape changes in a way old files can't be read as.
import { ParseDraft } from '@synkd/shared';
import { z } from 'zod';
import { PARSE_ERROR_KINDS, PDF_ENGINES } from '../openrouter';

export const RESULT_FORMAT_VERSION = 1;

const Rate = z.number().min(0).max(1);
const NullableNumber = z.number().nullable();

export const SampleScoreSchema = z.object({
  events: z.object({
    expected: z.int().min(0),
    predicted: z.int().min(0),
    matched: z.int().min(0),
    recall: Rate,
    precision: Rate,
    f1: Rate,
  }),
  time: z.object({ matched: z.int().min(0), exact: z.int().min(0), within5: z.int().min(0) }),
  recurrence: z.object({
    weeklyMatched: z.int().min(0),
    patternCorrect: z.int().min(0),
    rangeCorrect: z.boolean(),
    exceptions: z.object({
      expected: z.int().min(0),
      predicted: z.int().min(0),
      matched: z.int().min(0),
    }),
  }),
  edits: z.object({
    adds: z.int().min(0),
    deletes: z.int().min(0),
    fieldChanges: z.int().min(0),
    period: z.int().min(0),
    total: z.int().min(0),
    acceptable: z.boolean(),
  }),
});

export const SAMPLE_STATUSES = ['ok', 'failed', 'skipped'] as const;

export const SampleResult = z.object({
  id: z.string(),
  group: z.string().nullable(),
  fileType: z.string(),
  fileBytes: z.int().min(0),
  /** `ok`: parsed and valid. `failed`: request or output problem (scored as empty). `skipped`: not sent. */
  status: z.enum(SAMPLE_STATUSES),
  error: z
    .object({
      kind: z.enum([...PARSE_ERROR_KINDS, 'unsupported_format']),
      message: z.string(),
      status: z.number().optional(),
      issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
    })
    .nullable(),
  latencyMs: NullableNumber,
  usage: z
    .object({
      costUsd: NullableNumber,
      promptTokens: NullableNumber,
      completionTokens: NullableNumber,
    })
    .nullable(),
  generationId: z.string().nullable(),
  servedModel: z.string().nullable(),
  provider: z.string().nullable(),
  finishReason: z.string().nullable(),
  /** `null` for skipped samples. */
  score: SampleScoreSchema.nullable(),
  /** The validated model output. Only kept with `--keep-output`, because it holds titles. */
  output: ParseDraft.optional(),
});
export type SampleResult = z.infer<typeof SampleResult>;

const ScoreSummarySchema = z.object({
  samples: z.int().min(0),
  acceptance: Rate.nullable(),
  events: z.object({
    expected: z.int().min(0),
    predicted: z.int().min(0),
    matched: z.int().min(0),
    recall: Rate,
    precision: Rate,
    f1: Rate,
  }),
  macroF1: Rate.nullable(),
  timeExactRate: Rate.nullable(),
  timeWithin5Rate: Rate.nullable(),
  patternAccuracy: Rate.nullable(),
  rangeAccuracy: Rate.nullable(),
  exceptionRecall: Rate.nullable(),
  exceptionPrecision: Rate.nullable(),
  edits: z.object({ mean: NullableNumber, median: NullableNumber, max: NullableNumber }),
});

const GroupSummary = z.object({
  samples: z.int().min(0),
  acceptance: Rate.nullable(),
  f1: Rate,
});

export const RunSummary = z.object({
  samples: z.object({
    total: z.int().min(0),
    ok: z.int().min(0),
    failed: z.int().min(0),
    skipped: z.int().min(0),
  }),
  failuresByKind: z.record(z.string(), z.int().min(0)),
  /** Over ok and failed samples. Failed ones count as empty drafts. */
  scores: ScoreSummarySchema,
  cost: z.object({
    totalUsd: z.number(),
    meanUsd: NullableNumber,
    maxUsd: NullableNumber,
    /** How many samples reported a cost. Fewer than ok + failed means the totals are low. */
    reported: z.int().min(0),
  }),
  latency: z.object({
    meanMs: NullableNumber,
    p50Ms: NullableNumber,
    p95Ms: NullableNumber,
    maxMs: NullableNumber,
  }),
  byGroup: z.record(z.string(), GroupSummary),
});
export type RunSummary = z.infer<typeof RunSummary>;

export const EvalResult = z.object({
  formatVersion: z.literal(RESULT_FORMAT_VERSION),
  createdAt: z.iso.datetime(),
  run: z.object({
    model: z.string(),
    promptVersion: z.string(),
    promptSha256: z.string(),
    concurrency: z.int().min(1),
    timeoutMs: z.int().min(1),
    pdfEngine: z.enum(PDF_ENGINES).nullable(),
    zdr: z.boolean(),
    strictSchema: z.boolean(),
    keepOutput: z.boolean(),
  }),
  summary: RunSummary,
  samples: z.array(SampleResult),
});
export type EvalResult = z.infer<typeof EvalResult>;

/** `2026-09-30T17-38-05Z-google_gemini-2.5-flash-v1.json`: sorts by time, safe on every OS. */
export function resultFileName(createdAt: Date, model: string, promptVersion: string): string {
  const stamp = createdAt
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z')
    .replace(/:/g, '-');
  const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, '_');
  return `${stamp}-${safe(model)}-${safe(promptVersion)}.json`;
}
