import { describe, expect, it } from 'vitest';
import { SAMPLE_DRAFT } from '../testing';
import { compareResults, formatValue, parseResultFile, summarizeResult, table } from './compare';
import { EvalResult, RESULT_FORMAT_VERSION, type SampleResult } from './results';
import { summarizeRun } from './runner';
import { scoreSample } from './scoring';

function sample(
  id: string,
  predictedEvents: number,
  costUsd: number,
  latencyMs: number,
): SampleResult {
  const predicted = { events: SAMPLE_DRAFT.events.slice(0, predictedEvents) };
  return {
    id,
    group: null,
    fileType: 'png',
    fileBytes: 100,
    status: 'ok',
    error: null,
    latencyMs,
    usage: { costUsd, promptTokens: 1000, completionTokens: 100 },
    generationId: null,
    servedModel: null,
    provider: null,
    finishReason: 'stop',
    score: scoreSample(predicted, SAMPLE_DRAFT),
  };
}

function result(model: string, samples: SampleResult[], promptSha256 = 'abc'): EvalResult {
  return EvalResult.parse({
    formatVersion: RESULT_FORMAT_VERSION,
    createdAt: '2026-09-30T12:00:00.000Z',
    run: {
      model,
      promptVersion: 'v1',
      promptSha256,
      concurrency: 4,
      timeoutMs: 120000,
      pdfEngine: null,
      zdr: true,
      strictSchema: false,
      keepOutput: false,
    },
    summary: summarizeRun(samples),
    samples,
  });
}

describe('formatValue', () => {
  it('formats each kind of number', () => {
    expect(formatValue(0.8125, 'rate')).toBe('81.3%');
    expect(formatValue(0.00123, 'usd')).toBe('$0.0012');
    expect(formatValue(12345, 'ms')).toBe('12.3 s');
    expect(formatValue(1.25, 'edits')).toBe('1.3');
    expect(formatValue(null, 'rate')).toBe('–');
  });
});

describe('table', () => {
  it('pads columns', () => {
    expect(table(['A', 'Long header'], [['x', 'y']])).toBe(
      '| A | Long header |\n|---|-------------|\n| x | y           |',
    );
  });
});

describe('compareResults', () => {
  const a = result('model/a', [sample('s1', 0, 0.01, 30000), sample('s2', 1, 0.01, 20000)]);
  const b = result('model/b', [sample('s1', 1, 0.004, 10000), sample('s2', 1, 0.004, 12000)]);

  it('shows both runs, the change, and whether it is better or worse', () => {
    const text = compareResults(a, b);
    expect(text).toContain('A: model/a · prompt v1');
    expect(text).toMatch(/\| Acceptance \(≤ 3 edits\) +\| 100\.0% +\| 100\.0% +\| = +\|/);
    expect(text).toMatch(/\| Event recall +\| 50\.0% +\| 100\.0% +\| \+50\.0 pp \(better\)/);
    expect(text).toMatch(/\| Cost total +\| \$0\.0200 +\| \$0\.0080 +\| -\$0\.0120 \(better\)/);
    expect(text).toMatch(/\| Latency p95 +\| 30\.0 s +\| 12\.0 s +\| -18\.0 s \(better\)/);
    expect(text).toMatch(/\| s1 +\| 1 edits +\| 0 edits +\| better by 1/);
    expect(text).not.toContain('Warning');
  });

  it('never prints titles', () => {
    expect(compareResults(a, b)).not.toContain(SAMPLE_DRAFT.events[0]!.title);
  });

  it('warns about an edited prompt and about different sample sets', () => {
    const c = result('model/c', [sample('s1', 1, 0.01, 1000), sample('s3', 1, 0.01, 1000)], 'def');
    const text = compareResults(a, c);
    expect(text).toContain('prompt v1 was edited between these runs');
    expect(text).toContain('1 only in A, 1 only in B');
    expect(text).toContain('Only in A: s2');
    expect(text).toContain('Only in B: s3');
  });
});

describe('summarizeResult', () => {
  it('lists the aggregate metrics', () => {
    const text = summarizeResult(result('model/a', [sample('s1', 1, 0.01, 1000)]));
    expect(text).toContain('| Event F1');
    expect(text).toContain('100.0%');
  });
});

describe('parseResultFile', () => {
  it('rejects JSON that is not a result file', () => {
    expect(() => parseResultFile({ formatVersion: 99 }, 'x.json')).toThrow(
      /x\.json is not an eval result file/,
    );
  });
});
