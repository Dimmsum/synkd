import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MEMBER_PERMISSIONS,
  DEFAULT_TIER,
  PARSE_ATTEMPTS_PER_DAY,
  PARSE_JOB_MAX_ATTEMPTS,
  PARSE_MODEL_FALLBACK,
  PARSE_MODEL_PRIMARY,
  PARSE_PROMPT_VERSION,
  PARSER_VERSION,
  SCHEDULE_FILE_MAX_BYTES,
  SCHEDULE_FILE_MAX_PDF_PAGES,
  SCHEDULE_FILE_RETENTION_DAYS,
  SCHEDULE_IMAGE_MAX_EDGE_PX,
  TIER_VISIBLE_EVENT_FIELDS,
} from './constants';

describe('constants', () => {
  it('new connections start at T1 (D20)', () => {
    expect(DEFAULT_TIER).toBe(1);
  });

  it('new group members get invite and groupPing only (D26)', () => {
    expect(DEFAULT_MEMBER_PERMISSIONS).toEqual({
      invite: true,
      manageMembers: false,
      editGroup: false,
      groupPing: true,
    });
  });

  it('each tier reveals everything the tier below does, and never a location (D35)', () => {
    expect(TIER_VISIBLE_EVENT_FIELDS[1]).toEqual([]);
    for (const f of TIER_VISIBLE_EVENT_FIELDS[1]) expect(TIER_VISIBLE_EVENT_FIELDS[2]).toContain(f);
    for (const f of TIER_VISIBLE_EVENT_FIELDS[2]) expect(TIER_VISIBLE_EVENT_FIELDS[3]).toContain(f);
    expect(Object.values(TIER_VISIBLE_EVENT_FIELDS).flat()).not.toContain('location');
  });

  it('schedule file and parse limits match the PRD (FR-IMP-1, FR-IMP-15, FR-IMP-19, NFR-PERF-6)', () => {
    expect(SCHEDULE_FILE_MAX_BYTES).toBe(10 * 1024 * 1024);
    expect(SCHEDULE_FILE_MAX_PDF_PAGES).toBe(5);
    expect(SCHEDULE_FILE_RETENTION_DAYS).toBe(7);
    expect(PARSE_ATTEMPTS_PER_DAY).toBe(5);
    expect(PARSE_JOB_MAX_ATTEMPTS).toBe(3);
    expect(SCHEDULE_IMAGE_MAX_EDGE_PX).toBe(2000);
    expect(PARSER_VERSION).toContain(PARSE_PROMPT_VERSION);
    expect(PARSE_MODEL_PRIMARY).not.toBe(PARSE_MODEL_FALLBACK);
  });
});
