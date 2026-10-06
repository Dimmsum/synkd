import { describe, expect, it } from 'vitest';
import { DB_ERROR, PING_ERRORS } from '@synkd/backend';
import { pingError } from './errors';

describe('pingError', () => {
  it('asks "Ping anyway?" for someone who isn’t free (FR-PING-1)', () => {
    for (const [details, text] of [
      ['busy', 'busy'],
      ['away', 'away'],
      ['no_schedule', 'schedule'],
    ] as const) {
      const info = pingError({ code: DB_ERROR.pingNeedsConfirmation, details });
      expect(info?.needsConfirmation).toBe(true);
      expect(info?.message).toContain(text);
      expect(info?.message).toContain('Ping anyway?');
    }
  });

  it('explains dnd and paused, without offering to ping anyway', () => {
    const dnd = pingError({ code: DB_ERROR.pingRecipientUnavailable, details: 'dnd' });
    const paused = pingError({ code: DB_ERROR.pingRecipientUnavailable, details: 'paused' });
    expect(dnd).toEqual({ message: expect.stringContaining('do not disturb') });
    expect(paused).toEqual({ message: expect.stringContaining('paused sharing') });
  });

  it('a blocked sender reads the same as a missing person (FR-SOC-6)', () => {
    expect(pingError({ code: DB_ERROR.userNotFound, message: PING_ERRORS.userNotFound })).toEqual({
      message: 'We couldn’t find that person.',
    });
  });

  it('maps the rest by code, and bad arguments by message', () => {
    for (const code of [
      DB_ERROR.rateLimited,
      DB_ERROR.cannotTargetSelf,
      DB_ERROR.blockedByYou,
      DB_ERROR.pingNotFound,
      DB_ERROR.pingAlreadyReplied,
      DB_ERROR.noAccount,
    ])
      expect(pingError({ code })?.message).toBeTruthy();
    for (const message of [
      PING_ERRORS.invalidText,
      PING_ERRORS.unknownTemplate,
      PING_ERRORS.emptyPing,
      PING_ERRORS.replyNeedsOne,
      PING_ERRORS.unknownReply,
    ])
      expect(pingError({ code: '22023', message })?.message).toBeTruthy();
  });

  it('null for anything unexpected (logged by code, shown as "try again")', () => {
    expect(pingError({ code: '22023', message: 'range_end must be after range_start' })).toBeNull();
    expect(pingError({ code: '42501' })).toBeNull();
    expect(pingError({})).toBeNull();
  });
});
