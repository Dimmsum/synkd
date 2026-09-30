import { describe, expect, it } from 'vitest';
import { DEFAULT_MEMBER_PERMISSIONS, DEFAULT_TIER, TIER_VISIBLE_EVENT_FIELDS } from './constants';

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
});
