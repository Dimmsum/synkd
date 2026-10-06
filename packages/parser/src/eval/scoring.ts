// Scoring a parser's output against a hand-written expected draft (WF-022, NFR-OPS-3, FR-ADM-3).
//
// Pure functions, no I/O. The definitions are documented in `packages/parser/eval/README.md`;
// keep the two in sync. The headline number is "parse acceptance": the share of samples a user
// could confirm with at most 3 edits (PRD §10).
import type { DateRange, EventDraft, ParseDraft, WeekPattern } from '@synkd/shared';

/** Titles at least this similar can be matched even when the times differ. */
export const TITLE_MATCH_THRESHOLD = 0.5;
/** Titles at least this similar don't count as needing an edit (typos, a missing suffix). */
export const TITLE_EDIT_THRESHOLD = 0.9;
/** Times within this many minutes count as "close" (and allow a match on time alone). */
export const TIME_TOLERANCE_MINUTES = 5;
/** PRD §10 "parse acceptance": a parse confirmed with ≤ 3 edits. */
export const ACCEPTABLE_EDITS = 3;

const MINUTES_PER_DAY = 24 * 60;
/** Time differences beyond this add nothing more to a match's score. */
const TIME_SCORE_SPAN_MINUTES = 240;

// ---------------------------------------------------------------------------
// Units: one event on one day
// ---------------------------------------------------------------------------

/**
 * One event on one day. A weekly event on Mon and Wed becomes two units, so "one event on two
 * days" and "two events on one day each" score the same.
 */
export interface Unit {
  /** Index of the event the unit came from. */
  event: number;
  /** `w:<day>` for weekly events, `d:<YYYY-MM-DD>` for dated ones. Units only match on equal keys. */
  key: string;
  title: string;
  category: EventDraft['category'];
  /** Minutes since midnight. */
  start: number;
  /** Minutes since midnight, plus a day if the event runs past midnight. */
  end: number;
  /** The week pattern of a weekly event, `null` for a dated one. */
  pattern: WeekPattern | null;
}

export function toMinutes(time: string): number {
  const [h, m] = time.split(':');
  return Number(h) * 60 + Number(m);
}

export function expandUnits(events: readonly EventDraft[]): Unit[] {
  const units: Unit[] = [];
  events.forEach((e, event) => {
    const start = toMinutes(e.start);
    let end = toMinutes(e.end);
    if (end <= start) end += MINUTES_PER_DAY; // overnight
    const base = { event, title: e.title, category: e.category, start, end };
    if (e.when.kind === 'weekly') {
      for (const day of e.when.days)
        units.push({ ...base, key: `w:${day}`, pattern: e.when.pattern });
    } else {
      units.push({ ...base, key: `d:${e.when.date}`, pattern: null });
    }
  });
  return units;
}

// ---------------------------------------------------------------------------
// Titles
// ---------------------------------------------------------------------------

/** Lower-case, accents removed, anything that isn't a letter or digit turned into one space. */
export function normalizeTitle(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function bigrams(text: string): Map<string, number> {
  const out = new Map<string, number>();
  for (let i = 0; i < text.length - 1; i++) {
    const gram = text.slice(i, i + 2);
    out.set(gram, (out.get(gram) ?? 0) + 1);
  }
  return out;
}

/** Sørensen–Dice coefficient over character bigrams (spaces removed). */
function dice(a: string, b: string): number {
  const x = a.replace(/ /g, '');
  const y = b.replace(/ /g, '');
  if (x === y) return 1;
  if (x.length < 2 || y.length < 2) return 0;
  const bx = bigrams(x);
  const by = bigrams(y);
  let overlap = 0;
  for (const [gram, count] of bx) overlap += Math.min(count, by.get(gram) ?? 0);
  return (2 * overlap) / (x.length - 1 + (y.length - 1));
}

const hasCode = (token: string) => /\p{L}/u.test(token) && /\p{N}/u.test(token);

/**
 * How alike two titles are, 0–1. Equal after normalising → 1. One title's words all inside the
 * other's, covering at least half of them or including a course code like `COMP1161` → 0.9.
 * Otherwise the Dice coefficient of their character bigrams.
 */
export function titleSimilarity(a: string, b: string): number {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (na === nb) return 1;
  if (na === '' || nb === '') return 0;
  const ta = na.split(' ');
  const tb = nb.split(' ');
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  const longSet = new Set(long);
  if (
    short.every((t) => longSet.has(t)) &&
    (short.length / long.length >= 0.5 || short.some(hasCode))
  ) {
    return 0.9;
  }
  return dice(na, nb);
}

// ---------------------------------------------------------------------------
// Recurrence
// ---------------------------------------------------------------------------

/** Equal week patterns. Week lists compare as sets. */
export function samePattern(a: WeekPattern | null, b: WeekPattern | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.type !== b.type) return false;
  if (a.type === 'alternating' && b.type === 'alternating') return a.parity === b.parity;
  if (a.type === 'weeks' && b.type === 'weeks') {
    const set = new Set(a.weeks);
    return set.size === new Set(b.weeks).size && b.weeks.every((w) => set.has(w));
  }
  return true;
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

export interface UnitMatch {
  /** Index into the predicted units. */
  predicted: number;
  /** Index into the expected units. */
  expected: number;
}

/**
 * Pairs predicted units with expected ones. A pair is allowed when both are on the same day
 * (or date) and either the titles are similar (≥ `TITLE_MATCH_THRESHOLD`) or both times are
 * within `TIME_TOLERANCE_MINUTES`. Allowed pairs are taken greedily by score (title similarity +
 * time closeness, with small bonuses for equal category and week pattern), best first, each
 * unit used at most once. Ties break on index, so the result is deterministic.
 */
export function matchUnits(predicted: readonly Unit[], expected: readonly Unit[]): UnitMatch[] {
  const candidates: { p: number; e: number; score: number }[] = [];
  predicted.forEach((pu, p) => {
    expected.forEach((eu, e) => {
      if (pu.key !== eu.key) return;
      const sim = titleSimilarity(pu.title, eu.title);
      const ds = Math.abs(pu.start - eu.start);
      const de = Math.abs(pu.end - eu.end);
      const closeTimes = ds <= TIME_TOLERANCE_MINUTES && de <= TIME_TOLERANCE_MINUTES;
      if (sim < TITLE_MATCH_THRESHOLD && !closeTimes) return;
      const timeScore = 1 - Math.min(ds + de, TIME_SCORE_SPAN_MINUTES) / TIME_SCORE_SPAN_MINUTES;
      const score =
        sim +
        timeScore +
        (pu.category === eu.category ? 0.1 : 0) +
        (samePattern(pu.pattern, eu.pattern) ? 0.1 : 0);
      candidates.push({ p, e, score });
    });
  });
  candidates.sort((a, b) => b.score - a.score || a.p - b.p || a.e - b.e);
  const usedP = new Set<number>();
  const usedE = new Set<number>();
  const matches: UnitMatch[] = [];
  for (const c of candidates) {
    if (usedP.has(c.p) || usedE.has(c.e)) continue;
    usedP.add(c.p);
    usedE.add(c.e);
    matches.push({ predicted: c.p, expected: c.e });
  }
  return matches.sort((a, b) => a.expected - b.expected);
}

// ---------------------------------------------------------------------------
// Per-sample score
// ---------------------------------------------------------------------------

export interface SampleScore {
  /** Counted in units (one event on one day). */
  events: {
    expected: number;
    predicted: number;
    matched: number;
    recall: number;
    precision: number;
    f1: number;
  };
  /** Over matched units: both start and end exact, or both within ±5 min. */
  time: { matched: number; exact: number; within5: number };
  recurrence: {
    /** Matched units from weekly events, and how many of them have the right week pattern. */
    weeklyMatched: number;
    patternCorrect: number;
    /** The suggested date range: right if both ends are equal, or if neither side has one. */
    rangeCorrect: boolean;
    /** Exceptions (breaks, holidays) match on equal start and end. Labels are ignored. */
    exceptions: { expected: number; predicted: number; matched: number };
  };
  /** Estimated edits to turn the prediction into the expected draft. */
  edits: {
    adds: number;
    deletes: number;
    fieldChanges: number;
    period: number;
    total: number;
    /** `total ≤ ACCEPTABLE_EDITS` */
    acceptable: boolean;
  };
}

/** Recall or precision with the usual convention that nothing to find (or nothing claimed) is 1. */
function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : numerator / denominator;
}

function f1(recall: number, precision: number): number {
  return recall + precision === 0 ? 0 : (2 * recall * precision) / (recall + precision);
}

const rangeKey = (r: DateRange) => `${r.start}/${r.end}`;

function countExceptionMatches(
  expected: readonly DateRange[],
  predicted: readonly DateRange[],
): number {
  const pool = new Map<string, number>();
  for (const r of predicted) pool.set(rangeKey(r), (pool.get(rangeKey(r)) ?? 0) + 1);
  let matched = 0;
  for (const r of expected) {
    const left = pool.get(rangeKey(r)) ?? 0;
    if (left > 0) {
      matched++;
      pool.set(rangeKey(r), left - 1);
    }
  }
  return matched;
}

/** Fields of a matched event pair that the user would have to change. */
function fieldChanges(p: EventDraft, e: EventDraft): number {
  let n = 0;
  if (titleSimilarity(p.title, e.title) < TITLE_EDIT_THRESHOLD) n++;
  if (p.category !== e.category) n++;
  if (p.start !== e.start) n++;
  if (p.end !== e.end) n++;
  if (
    p.when.kind === 'weekly' &&
    e.when.kind === 'weekly' &&
    !samePattern(p.when.pattern, e.when.pattern)
  ) {
    n++;
  }
  return n;
}

/**
 * Scores one sample. `predicted` is `null` when the parse failed; it then scores as an empty
 * draft, so failures count against recall and acceptance.
 */
export function scoreSample(predicted: ParseDraft | null, expected: ParseDraft): SampleScore {
  const pEvents = predicted?.events ?? [];
  const eEvents = expected.events;
  const pUnits = expandUnits(pEvents);
  const eUnits = expandUnits(eEvents);
  const matches = matchUnits(pUnits, eUnits);

  let exact = 0;
  let within5 = 0;
  let weeklyMatched = 0;
  let patternCorrect = 0;
  const pairs = new Set<string>();
  for (const m of matches) {
    const pu = pUnits[m.predicted]!;
    const eu = eUnits[m.expected]!;
    const ds = Math.abs(pu.start - eu.start);
    const de = Math.abs(pu.end - eu.end);
    if (ds === 0 && de === 0) exact++;
    if (ds <= TIME_TOLERANCE_MINUTES && de <= TIME_TOLERANCE_MINUTES) within5++;
    if (eu.pattern !== null) {
      weeklyMatched++;
      if (samePattern(pu.pattern, eu.pattern)) patternCorrect++;
    }
    pairs.add(`${pu.event}:${eu.event}`);
  }

  // An event missing some or all of its days is one edit (add it, or add the days), and the
  // same for an extra event. Each matched event pair costs one edit per wrong field.
  const matchedP = new Set(matches.map((m) => m.predicted));
  const matchedE = new Set(matches.map((m) => m.expected));
  const adds = new Set(eUnits.filter((_, i) => !matchedE.has(i)).map((u) => u.event)).size;
  const deletes = new Set(pUnits.filter((_, i) => !matchedP.has(i)).map((u) => u.event)).size;
  let changes = 0;
  for (const pair of pairs) {
    const [p, e] = pair.split(':').map(Number) as [number, number];
    changes += fieldChanges(pEvents[p]!, eEvents[e]!);
  }

  const ep = expected.suggestedPeriod;
  const pp = predicted?.suggestedPeriod;
  const rangeCorrect = ep
    ? pp !== undefined && pp.start === ep.start && pp.end === ep.end
    : pp === undefined;
  const eExceptions = ep?.exceptions ?? [];
  const pExceptions = pp?.exceptions ?? [];
  const exceptionsMatched = countExceptionMatches(eExceptions, pExceptions);
  // With no expected period, removing the suggested one is a single edit, exceptions included.
  const periodEdits =
    (rangeCorrect ? 0 : 1) +
    (ep ? eExceptions.length - exceptionsMatched + (pExceptions.length - exceptionsMatched) : 0);

  const recall = ratio(matches.length, eUnits.length);
  const precision = ratio(matches.length, pUnits.length);
  const total = adds + deletes + changes + periodEdits;
  return {
    events: {
      expected: eUnits.length,
      predicted: pUnits.length,
      matched: matches.length,
      recall,
      precision,
      f1: f1(recall, precision),
    },
    time: { matched: matches.length, exact, within5 },
    recurrence: {
      weeklyMatched,
      patternCorrect,
      rangeCorrect,
      exceptions: {
        expected: eExceptions.length,
        predicted: pExceptions.length,
        matched: exceptionsMatched,
      },
    },
    edits: {
      adds,
      deletes,
      fieldChanges: changes,
      period: periodEdits,
      total,
      acceptable: total <= ACCEPTABLE_EDITS,
    },
  };
}

// ---------------------------------------------------------------------------
// Aggregates across samples
// ---------------------------------------------------------------------------

export interface ScoreSummary {
  samples: number;
  /** Share of samples with ≤ 3 edits (PRD §10 parse acceptance, target ≥ 0.7). */
  acceptance: number | null;
  /** Micro-averaged over all units in all samples. */
  events: {
    expected: number;
    predicted: number;
    matched: number;
    recall: number;
    precision: number;
    f1: number;
  };
  /** Mean of the per-sample F1 scores, so one huge timetable can't dominate. */
  macroF1: number | null;
  timeExactRate: number | null;
  timeWithin5Rate: number | null;
  patternAccuracy: number | null;
  rangeAccuracy: number | null;
  exceptionRecall: number | null;
  exceptionPrecision: number | null;
  edits: { mean: number | null; median: number | null; max: number | null };
}

const rate = (n: number, d: number): number | null => (d === 0 ? null : n / d);
const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

export function median(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Nearest-rank percentile, `p` in 0–100. */
export function percentile(xs: readonly number[], p: number): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * s.length));
  return s[rank - 1]!;
}

export function summarizeScores(scores: readonly SampleScore[]): ScoreSummary {
  const expected = sum(scores.map((s) => s.events.expected));
  const predicted = sum(scores.map((s) => s.events.predicted));
  const matched = sum(scores.map((s) => s.events.matched));
  const recall = ratio(matched, expected);
  const precision = ratio(matched, predicted);
  const timeMatched = sum(scores.map((s) => s.time.matched));
  const edits = scores.map((s) => s.edits.total);
  const exE = sum(scores.map((s) => s.recurrence.exceptions.expected));
  const exP = sum(scores.map((s) => s.recurrence.exceptions.predicted));
  const exM = sum(scores.map((s) => s.recurrence.exceptions.matched));
  return {
    samples: scores.length,
    acceptance: rate(scores.filter((s) => s.edits.acceptable).length, scores.length),
    events: { expected, predicted, matched, recall, precision, f1: f1(recall, precision) },
    macroF1: rate(sum(scores.map((s) => s.events.f1)), scores.length),
    timeExactRate: rate(sum(scores.map((s) => s.time.exact)), timeMatched),
    timeWithin5Rate: rate(sum(scores.map((s) => s.time.within5)), timeMatched),
    patternAccuracy: rate(
      sum(scores.map((s) => s.recurrence.patternCorrect)),
      sum(scores.map((s) => s.recurrence.weeklyMatched)),
    ),
    rangeAccuracy: rate(scores.filter((s) => s.recurrence.rangeCorrect).length, scores.length),
    exceptionRecall: rate(exM, exE),
    exceptionPrecision: rate(exM, exP),
    edits: {
      mean: rate(sum(edits), edits.length),
      median: median(edits),
      max: edits.length === 0 ? null : Math.max(...edits),
    },
  };
}
