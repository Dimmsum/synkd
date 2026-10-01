import { describe, expect, it } from 'vitest';
import { describeOverride, nextLocalTime, parseStatusInput } from './manual-status';

const JM = 'America/Jamaica'; // UTC-5, no DST
const now = '2026-09-30T19:30:00Z'; // 2:30 PM in Jamaica
const inHours = (h: number) => new Date(Date.parse(now) + h * 3_600_000).toISOString();

describe('parseStatusInput (FR-AVL-3)', () => {
  it('null status means back to automatic', () => {
    expect(parseStatusInput({ status: null, until: null }, now)).toEqual({ ok: true, clear: true });
  });

  it('"until I change it" sends no end time', () => {
    expect(parseStatusInput({ status: 'dnd', until: null }, now)).toEqual({
      ok: true,
      clear: false,
      args: { status: 'dnd' },
    });
  });

  it('sends an end time and a trimmed note', () => {
    expect(
      parseStatusInput(
        { status: 'focused', until: inHours(2), label: '  Revising MATH1141 ' },
        now,
      ),
    ).toEqual({
      ok: true,
      clear: false,
      args: { status: 'focused', label: 'Revising MATH1141', ends_at: inHours(2) },
    });
  });

  it('drops a blank note', () => {
    const r = parseStatusInput({ status: 'busy', until: null, label: '   ' }, now);
    expect(r).toEqual({ ok: true, clear: false, args: { status: 'busy' } });
  });

  it('rejects an unknown status, a long note and a note with control characters', () => {
    expect(parseStatusInput({ status: 'sleeping' as never, until: null }, now).ok).toBe(false);
    expect(parseStatusInput({ status: 'busy', until: null, label: 'a'.repeat(41) }, now).ok).toBe(
      false,
    );
    expect(parseStatusInput({ status: 'busy', until: null, label: 'a\nb' }, now).ok).toBe(false);
  });

  it('accepts a 40-character note', () => {
    expect(parseStatusInput({ status: 'busy', until: null, label: 'a'.repeat(40) }, now).ok).toBe(
      true,
    );
  });

  it('rejects an end time in the past, unparseable, or more than 7 days away', () => {
    expect(parseStatusInput({ status: 'away', until: inHours(-1) }, now).ok).toBe(false);
    expect(parseStatusInput({ status: 'away', until: now }, now).ok).toBe(false);
    expect(parseStatusInput({ status: 'away', until: 'tomorrow' }, now).ok).toBe(false);
    expect(parseStatusInput({ status: 'away', until: inHours(7 * 24 + 1) }, now).ok).toBe(false);
    expect(parseStatusInput({ status: 'away', until: inHours(7 * 24) }, now).ok).toBe(true);
  });
});

describe('nextLocalTime ("until 4 PM")', () => {
  it('is later today when that time has not passed', () => {
    expect(nextLocalTime('16:00', now, JM)?.toISOString()).toBe('2026-09-30T21:00:00.000Z');
  });

  it('is tomorrow when that time has passed', () => {
    expect(nextLocalTime('09:00', now, JM)?.toISOString()).toBe('2026-10-01T14:00:00.000Z');
    expect(nextLocalTime('14:30', now, JM)?.toISOString()).toBe('2026-10-01T19:30:00.000Z');
  });

  it('rejects a malformed time', () => {
    expect(nextLocalTime('4pm', now, JM)).toBeNull();
    expect(nextLocalTime('24:00', now, JM)).toBeNull();
  });
});

describe('describeOverride (NFR-UX-1: words, not just colour)', () => {
  it('names the status and its end', () => {
    expect(
      describeOverride({ status: 'focused', label: null, endsAt: inHours(1.5) }, now, JM),
    ).toEqual({ tone: 'busy', label: 'Studying/Focused until 4:00 PM' });
  });

  it('has no end for "until I change it", and carries the note', () => {
    expect(describeOverride({ status: 'dnd', label: 'Exam', endsAt: null }, now, JM)).toEqual({
      tone: 'dnd',
      label: 'Do not disturb',
      detail: 'Exam',
    });
  });
});
