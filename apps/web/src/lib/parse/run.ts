// One parse run (WF-027, PRD §8.5, D46, WF-024 §7): a claimed job's file is downloaded from
// Storage, checked, converted to images in memory (never stored, D38), sent to the model once,
// and the result stored, or the failure recorded so the job is retried with backoff or marked
// failed. Pure orchestration over injected dependencies, so every branch is unit-tested; the
// real ones (secret-key Supabase, the converter, OpenRouter) are wired in runner.ts.
//
// Logging (NFR-SEC-11): an error code, a failure kind or an HTTP status, never the file, the
// draft, a title or the model's output.

import { createHash } from 'node:crypto';
import type { ParseRun } from '@whosfree/backend';
import type { ParseOutcome } from '@whosfree/parser/node';
import { SCHEDULE_FILE_MAX_BYTES, type ParseErrorCode } from '@whosfree/shared';
import type { ParseAdmin } from './admin';

export type ConvertOutcome =
  | { ok: true; pages: number; images: { bytes: Uint8Array }[] }
  | { ok: false; code: ParseErrorCode };

export interface RunDeps {
  admin: Pick<ParseAdmin, 'download' | 'complete' | 'fail'>;
  /** Converts the file (ConvertError → `{ ok: false }`); anything thrown is internal. */
  convert(bytes: Uint8Array): Promise<ConvertOutcome>;
  parse(input: {
    images: { bytes: Uint8Array }[];
    apiKey: string;
    attempt: number;
  }): Promise<ParseOutcome>;
  /** OPENROUTER_API_KEY, server-only (NFR-SEC-8). */
  apiKey: string | null;
}

export type RunResult = 'ready' | 'retry' | 'failed' | 'stale';

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Runs one claimed job to its next state. Never throws. */
export async function processRun(run: ParseRun, deps: RunDeps): Promise<RunResult> {
  const fail = async (
    error: ParseErrorCode,
    retryable: boolean,
    extra: { model?: string | null; parserVersion?: string | null; costUsd?: number | null } = {},
  ): Promise<RunResult> => {
    try {
      const status = await deps.admin.fail({
        jobId: run.id,
        attempt: run.attempt,
        error,
        retryable,
        ...extra,
      });
      return status === null ? 'stale' : status === 'queued' ? 'retry' : 'failed';
    } catch (err) {
      // The lease runs out and the sweep tries again.
      console.error('Recording a parse failure failed', (err as Error).message);
      return 'retry';
    }
  };

  let bytes: Uint8Array | null;
  try {
    bytes = await deps.admin.download(run.storage_path);
  } catch (err) {
    console.warn('Parse run: download failed', (err as Error).message);
    return fail('parse_failed', true);
  }
  if (bytes === null) return fail('file_missing', false);
  if (bytes.byteLength > SCHEDULE_FILE_MAX_BYTES) return fail('file_too_large', false);
  // Not the file that was registered (NFR-SEC-6): don't read it.
  if (sha256Hex(bytes) !== run.sha256) return fail('unsupported_file', false);

  let converted: ConvertOutcome;
  try {
    converted = await deps.convert(bytes);
  } catch (err) {
    console.error('Parse run: conversion crashed', (err as Error).name);
    return fail('parse_failed', true);
  }
  if (!converted.ok) return fail(converted.code, false);

  if (!deps.apiKey) {
    console.error('Parse run: OPENROUTER_API_KEY is not set');
    return fail('parse_failed', true);
  }

  const outcome = await deps.parse({
    images: converted.images,
    apiKey: deps.apiKey,
    attempt: run.attempt,
  });
  if (!outcome.ok) {
    console.warn('Parse run: model attempt failed', outcome.kind, outcome.status ?? '');
    return fail(outcome.code, outcome.retryable, {
      model: outcome.model,
      parserVersion: outcome.parserVersion,
      costUsd: outcome.costUsd,
    });
  }

  try {
    const stored = await deps.admin.complete({
      jobId: run.id,
      attempt: run.attempt,
      draft: outcome.draft,
      model: outcome.model,
      parserVersion: outcome.parserVersion,
      costUsd: outcome.costUsd,
      confidence: outcome.confidence,
      pages: converted.pages,
    });
    return stored ? 'ready' : 'stale';
  } catch (err) {
    console.error('Parse run: storing the draft failed', (err as Error).message);
    return fail('parse_failed', true, {
      model: outcome.model,
      parserVersion: outcome.parserVersion,
      costUsd: outcome.costUsd,
    });
  }
}
