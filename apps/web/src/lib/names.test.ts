import { describe, expect, it } from 'vitest';
import { DEFAULT_DISPLAY_NAME } from '@synkd/shared';
import { shortName } from './names';

describe('shortName (WF-136)', () => {
  it('is the first word of a real name', () => {
    expect(shortName({ name: 'Alice Brown', handle: 'alice' })).toBe('Alice');
    expect(shortName({ name: 'Tia', handle: null })).toBe('Tia');
  });

  it('is the handle while the name is still the default', () => {
    expect(shortName({ name: DEFAULT_DISPLAY_NAME, handle: 'quiet-otter-42' })).toBe(
      '@quiet-otter-42',
    );
  });

  it('falls back to the name without a handle', () => {
    expect(shortName({ name: DEFAULT_DISPLAY_NAME, handle: '' })).toBe('New');
  });
});
