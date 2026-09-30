import { PING_TEXT_MAX_LENGTH, type Status } from '@whosfree/shared';

export type PingPolicy = 'allowed' | 'confirm' | 'blocked';

/**
 * FR-PING-1: free → ping straight away; busy or away (and no schedule) → ask first;
 * do not disturb or paused → blocked. The server enforces this too (WF-092).
 */
export function pingPolicy(status: Status): PingPolicy {
  switch (status) {
    case 'free':
      return 'allowed';
    case 'dnd':
    case 'paused':
      return 'blocked';
    default:
      return 'confirm';
  }
}

/** Characters used, counting emoji as one (matches the shared PingText schema, D31). */
export function pingLength(text: string): number {
  return [...text.trim()].length;
}

export function pingCharsLeft(text: string): number {
  return PING_TEXT_MAX_LENGTH - pingLength(text);
}
