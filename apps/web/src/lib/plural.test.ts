import { describe, expect, it } from 'vitest';
import { countOf } from './plural';

describe('countOf (WF-136)', () => {
  it('uses the singular for exactly one', () => {
    expect(countOf(1, 'friend')).toBe('1 friend');
    expect(countOf(1, 'member')).toBe('1 member');
  });

  it('uses the plural otherwise', () => {
    expect(countOf(0, 'friend')).toBe('0 friends');
    expect(countOf(2, 'member')).toBe('2 members');
    expect(countOf(3, 'person', 'people')).toBe('3 people');
  });
});
