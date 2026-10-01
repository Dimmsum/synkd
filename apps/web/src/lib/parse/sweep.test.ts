import { describe, expect, it, vi } from 'vitest';
import { isInternalRequest, internalBaseUrl, internalSecret } from './internal';
import { sweep } from './sweep';

const SECRET = 'a-long-enough-cron-secret-123456';

describe('internal route auth (CRON_SECRET)', () => {
  const req = (auth?: string) =>
    new Request('https://app.test/api/internal/parse-jobs/sweep', {
      method: 'POST',
      headers: auth ? { authorization: auth } : {},
    });

  it('accepts only the bearer secret', () => {
    const env = { CRON_SECRET: SECRET };
    expect(isInternalRequest(req(`Bearer ${SECRET}`), env)).toBe(true);
    expect(isInternalRequest(req(`Bearer ${SECRET}x`), env)).toBe(false);
    expect(isInternalRequest(req(SECRET), env)).toBe(false);
    expect(isInternalRequest(req(), env)).toBe(false);
  });

  it('refuses everything while the secret is unset or too short', () => {
    expect(internalSecret({})).toBeNull();
    expect(internalSecret({ CRON_SECRET: 'short' })).toBeNull();
    expect(isInternalRequest(req('Bearer '), { CRON_SECRET: '' })).toBe(false);
    expect(isInternalRequest(req('Bearer short'), { CRON_SECRET: 'short' })).toBe(false);
  });

  it('reaches itself on INTERNAL_APP_URL, else the public URL', () => {
    expect(internalBaseUrl({ NEXT_PUBLIC_APP_URL: 'https://whosfree.app/' })).toBe(
      'https://whosfree.app',
    );
    expect(
      internalBaseUrl({
        NEXT_PUBLIC_APP_URL: 'https://whosfree.app',
        INTERNAL_APP_URL: 'http://127.0.0.1:3000',
      }),
    ).toBe('http://127.0.0.1:3000');
    expect(internalBaseUrl({})).toBeNull();
  });
});

describe('sweep (NFR-REL-4, FR-ADM-4, D38)', () => {
  function admin(removeOk = true) {
    return {
      listDue: vi.fn(async () => ['j1', 'j2']),
      expireFiles: vi.fn(async () => 3),
      claimRemovals: vi.fn(async () => ['u/a', 'u/b']),
      remove: vi.fn(async () => removeOk),
      finishRemovals: vi.fn(async (paths: string[]) => paths.length),
    };
  }

  it('re-dispatches due jobs, expires old files and removes their objects', async () => {
    const a = admin();
    const dispatch = vi.fn(async () => undefined);
    expect(await sweep({ admin: a, dispatch })).toEqual({
      dispatched: 2,
      expiredFiles: 3,
      removedObjects: 2,
      removalsLeft: 0,
    });
    expect(dispatch.mock.calls).toEqual([['j1'], ['j2']]);
    expect(a.finishRemovals).toHaveBeenCalledWith(['u/a', 'u/b']);
  });

  it('keeps removals queued when Storage refuses them', async () => {
    const a = admin(false);
    const result = await sweep({ admin: a, dispatch: async () => undefined });
    expect(result).toMatchObject({ removedObjects: 0, removalsLeft: 2 });
    expect(a.finishRemovals).not.toHaveBeenCalled();
  });
});
