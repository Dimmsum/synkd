// Side-by-side comparison of two eval result files, as a plain-text table (WF-022, FR-ADM-3).
// Shows numbers and sample ids only, never titles or other schedule contents (NFR-SEC-11).
import { EvalResult } from './results';

type Kind = 'rate' | 'count' | 'usd' | 'ms' | 'edits';

interface MetricRow {
  label: string;
  kind: Kind;
  /** For rates and counts, whether a higher number is better. Shown as `+`/`-` next to the change. */
  higherIsBetter?: boolean;
  get: (r: EvalResult) => number | null;
}

const METRICS: MetricRow[] = [
  { label: 'Samples scored', kind: 'count', get: (r) => r.summary.scores.samples },
  { label: 'Failed', kind: 'count', higherIsBetter: false, get: (r) => r.summary.samples.failed },
  { label: 'Skipped', kind: 'count', get: (r) => r.summary.samples.skipped },
  {
    label: 'Acceptance (≤ 3 edits)',
    kind: 'rate',
    higherIsBetter: true,
    get: (r) => r.summary.scores.acceptance,
  },
  {
    label: 'Event recall',
    kind: 'rate',
    higherIsBetter: true,
    get: (r) => r.summary.scores.events.recall,
  },
  {
    label: 'Event precision',
    kind: 'rate',
    higherIsBetter: true,
    get: (r) => r.summary.scores.events.precision,
  },
  { label: 'Event F1', kind: 'rate', higherIsBetter: true, get: (r) => r.summary.scores.events.f1 },
  { label: 'Macro F1', kind: 'rate', higherIsBetter: true, get: (r) => r.summary.scores.macroF1 },
  {
    label: 'Time exact',
    kind: 'rate',
    higherIsBetter: true,
    get: (r) => r.summary.scores.timeExactRate,
  },
  {
    label: 'Time ±5 min',
    kind: 'rate',
    higherIsBetter: true,
    get: (r) => r.summary.scores.timeWithin5Rate,
  },
  {
    label: 'Week pattern',
    kind: 'rate',
    higherIsBetter: true,
    get: (r) => r.summary.scores.patternAccuracy,
  },
  {
    label: 'Date range',
    kind: 'rate',
    higherIsBetter: true,
    get: (r) => r.summary.scores.rangeAccuracy,
  },
  {
    label: 'Exception recall',
    kind: 'rate',
    higherIsBetter: true,
    get: (r) => r.summary.scores.exceptionRecall,
  },
  {
    label: 'Exception precision',
    kind: 'rate',
    higherIsBetter: true,
    get: (r) => r.summary.scores.exceptionPrecision,
  },
  {
    label: 'Edits (mean)',
    kind: 'edits',
    higherIsBetter: false,
    get: (r) => r.summary.scores.edits.mean,
  },
  {
    label: 'Edits (median)',
    kind: 'edits',
    higherIsBetter: false,
    get: (r) => r.summary.scores.edits.median,
  },
  { label: 'Cost total', kind: 'usd', higherIsBetter: false, get: (r) => r.summary.cost.totalUsd },
  {
    label: 'Cost per sample (mean)',
    kind: 'usd',
    higherIsBetter: false,
    get: (r) => r.summary.cost.meanUsd,
  },
  {
    label: 'Cost per sample (max)',
    kind: 'usd',
    higherIsBetter: false,
    get: (r) => r.summary.cost.maxUsd,
  },
  { label: 'Latency p50', kind: 'ms', higherIsBetter: false, get: (r) => r.summary.latency.p50Ms },
  { label: 'Latency p95', kind: 'ms', higherIsBetter: false, get: (r) => r.summary.latency.p95Ms },
];

export function formatValue(value: number | null, kind: Kind): string {
  if (value === null) return '–';
  switch (kind) {
    case 'rate':
      return `${(value * 100).toFixed(1)}%`;
    case 'count':
      return String(value);
    case 'edits':
      return value.toFixed(1);
    case 'usd':
      return `$${value.toFixed(4)}`;
    case 'ms':
      return `${(value / 1000).toFixed(1)} s`;
  }
}

function formatDelta(a: number | null, b: number | null, row: MetricRow): string {
  if (a === null || b === null) return '';
  const d = b - a;
  if (Math.abs(d) < 1e-9) return '=';
  const sign = d > 0 ? '+' : '-';
  const abs = Math.abs(d);
  const text =
    row.kind === 'rate'
      ? `${sign}${(abs * 100).toFixed(1)} pp`
      : row.kind === 'usd'
        ? `${sign}$${abs.toFixed(4)}`
        : row.kind === 'ms'
          ? `${sign}${(abs / 1000).toFixed(1)} s`
          : row.kind === 'edits'
            ? `${sign}${abs.toFixed(1)}`
            : `${sign}${abs}`;
  if (row.higherIsBetter === undefined) return text;
  const better = row.higherIsBetter ? d > 0 : d < 0;
  return `${text} ${better ? '(better)' : '(worse)'}`;
}

/** Renders rows as a Markdown-style table with padded columns. */
export function table(header: string[], rows: string[][]): string {
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)));
  const line = (cells: string[]) => `| ${cells.map((c, i) => c.padEnd(widths[i]!)).join(' | ')} |`;
  return [
    line(header),
    `|${widths.map((w) => '-'.repeat(w + 2)).join('|')}|`,
    ...rows.map(line),
  ].join('\n');
}

function label(r: EvalResult): string {
  return `${r.run.model} · prompt ${r.run.promptVersion} · ${r.createdAt}`;
}

/** One run's aggregate numbers, for printing after a run. */
export function summarizeResult(r: EvalResult): string {
  const failures = Object.entries(r.summary.failuresByKind)
    .map(([kind, n]) => `${kind} ${n}`)
    .join(', ');
  return [
    label(r),
    ...(failures ? [`Not scored normally: ${failures}`] : []),
    '',
    table(
      ['Metric', 'Value'],
      METRICS.map((row) => [row.label, formatValue(row.get(r), row.kind)]),
    ),
  ].join('\n');
}

/** Compares run `a` (the baseline) with run `b`. */
export function compareResults(a: EvalResult, b: EvalResult): string {
  const out: string[] = [`A: ${label(a)}`, `B: ${label(b)}`];
  if (a.run.promptVersion === b.run.promptVersion && a.run.promptSha256 !== b.run.promptSha256) {
    out.push(
      `Warning: prompt ${a.run.promptVersion} was edited between these runs (the text differs).`,
    );
  }
  const aIds = new Set(a.samples.map((s) => s.id));
  const bIds = new Set(b.samples.map((s) => s.id));
  const onlyA = [...aIds].filter((id) => !bIds.has(id));
  const onlyB = [...bIds].filter((id) => !aIds.has(id));
  if (onlyA.length > 0 || onlyB.length > 0) {
    out.push(
      `Warning: the runs used different samples (${onlyA.length} only in A, ${onlyB.length} only in B), so the totals aren't directly comparable.`,
    );
  }

  out.push(
    '',
    table(
      ['Metric', 'A', 'B', 'Change'],
      METRICS.map((row) => {
        const va = row.get(a);
        const vb = row.get(b);
        return [
          row.label,
          formatValue(va, row.kind),
          formatValue(vb, row.kind),
          formatDelta(va, vb, row),
        ];
      }),
    ),
  );

  const bById = new Map(b.samples.map((s) => [s.id, s]));
  const perSample = a.samples
    .filter((s) => bById.has(s.id))
    .map((sa) => {
      const sb = bById.get(sa.id)!;
      const cell = (s: typeof sa) =>
        s.status === 'skipped'
          ? 'skipped'
          : `${s.score?.edits.total ?? '–'} edits${s.status === 'failed' ? ` (${s.error?.kind ?? 'failed'})` : ''}`;
      const ea = sa.score?.edits.total;
      const eb = sb.score?.edits.total;
      const change =
        ea === undefined || eb === undefined
          ? ''
          : eb === ea
            ? '='
            : eb < ea
              ? `better by ${ea - eb}`
              : `worse by ${eb - ea}`;
      return [sa.id, cell(sa), cell(sb), change];
    });
  if (perSample.length > 0) {
    out.push('', table(['Sample', 'A', 'B', 'Change'], perSample));
  }
  if (onlyA.length > 0) out.push('', `Only in A: ${onlyA.join(', ')}`);
  if (onlyB.length > 0) out.push('', `Only in B: ${onlyB.join(', ')}`);
  return out.join('\n');
}

/** Validates a result file's JSON. Throws with the schema problems if it isn't one. */
export function parseResultFile(json: unknown, name: string): EvalResult {
  const parsed = EvalResult.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.map(String).join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new Error(`${name} is not an eval result file (${issues})`);
  }
  return parsed.data;
}
