import { describe, expect, it } from 'vitest';
import {
  HANDLE_MAX_LENGTH,
  Handle,
  HandleInput,
  RESERVED_HANDLES,
  isReservedHandle,
  normalizeHandleInput,
} from './handles';

describe('Handle', () => {
  it.each(['kemar', 'KemarJ', 'k_j', 'abc', 'a1_', 'x'.repeat(HANDLE_MAX_LENGTH), 'Admin_2'])(
    'accepts %j',
    (h) => {
      expect(Handle.parse(h)).toBe(h);
    },
  );

  it.each([
    ['ab', 'too short'],
    ['x'.repeat(HANDLE_MAX_LENGTH + 1), 'too long'],
    ['1kemar', 'starts with a digit'],
    ['_kemar', 'starts with an underscore'],
    ['kemar.j', 'has a dot'],
    ['kemar-j', 'has a hyphen'],
    ['kem ar', 'has a space'],
    ['@kemar', 'has an @ (not normalised)'],
    ['kémar', 'has a non-ASCII letter'],
    ['kеmar', 'has a Cyrillic look-alike'],
    ['', 'is empty'],
  ])('rejects %j (%s)', (h) => {
    expect(Handle.safeParse(h).success).toBe(false);
  });

  it('rejects every reserved word, ignoring case', () => {
    for (const r of RESERVED_HANDLES) {
      expect(Handle.safeParse(r).success).toBe(false);
      expect(Handle.safeParse(r.toUpperCase()).success).toBe(false);
    }
  });

  it.each(['Synkd', 'synkd_help', 'the_synkd_team', 'xSYNKDx', 'GetSynked', 'synked_app'])(
    'rejects handles containing "synkd" or "synked" (%j)',
    (h) => {
      expect(Handle.safeParse(h).success).toBe(false);
    },
  );

  it('gives a readable message for reserved handles', () => {
    const result = Handle.safeParse('Settings');
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('That handle is reserved');
  });
});

describe('RESERVED_HANDLES', () => {
  it('is lowercase, sorted and has no duplicates', () => {
    const list: readonly string[] = RESERVED_HANDLES;
    for (const r of list) expect(r).toBe(r.toLowerCase());
    expect([...list].sort()).toEqual(list);
    expect(new Set(list).size).toBe(list.length);
  });

  it('covers the app routes', () => {
    for (const r of ['admin', 'support', 'help', 'settings', 'api', 'now', 'groups', 'inbox', 'i'])
      expect(isReservedHandle(r)).toBe(true);
    for (const r of ['invite', 'synkd', 'Invite']) expect(isReservedHandle(r)).toBe(true);
    expect(isReservedHandle('badminton')).toBe(false);
  });
});

describe('HandleInput', () => {
  it('strips surrounding spaces and one leading @', () => {
    expect(normalizeHandleInput('  @Kemar ')).toBe('Kemar');
    expect(HandleInput.parse(' @kemar_j ')).toBe('kemar_j');
    expect(HandleInput.safeParse('@@kemar').success).toBe(false);
    expect(HandleInput.safeParse('@admin').success).toBe(false);
  });
});
