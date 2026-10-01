import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PushPayload } from './payload';
import type { PushStore, StoredPushSubscription } from './store';
import type { VapidConfig } from './config';

vi.mock('server-only', () => ({}));
// web-push is mocked throughout: no test may reach a real push service.
const webPushSend = vi.hoisted(() => vi.fn());
vi.mock('web-push', () => ({ default: { sendNotification: webPushSend } }));
// The real store would build a secret-key Supabase client; tests never do.
const createPushStore = vi.hoisted(() => vi.fn());
vi.mock('./store', () => ({ createPushStore }));

const { sendPushToUser, resetPushWarningsForTests, DEFAULT_PUSH_TTL_SECONDS } =
  await import('./send');

const USER = '6f1c1a3e-9a52-4c1e-9f55-2b0d0c1e7a11';
const VAPID: VapidConfig = {
  subject: 'mailto:support@whosfree.app',
  publicKey:
    'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U',
  privateKey: 'UUxI4O8-FbRouAevSmBQ6o18hgE4nSG3qwvJTfKc-ls',
};
const PING: PushPayload = {
  v: 1,
  kind: 'ping',
  title: 'Kemar pinged you',
  body: 'SECRET PING TEXT',
  url: '/inbox',
  tag: 'ping:1',
};

function sub(n: number): StoredPushSubscription {
  return {
    id: `sub-${n}`,
    endpoint: `https://push.example.test/SECRET-ENDPOINT-${n}`,
    p256dh: `p256dh-${n}`,
    auth: `auth-${n}`,
  };
}

function fakeStore(subs: StoredPushSubscription[]) {
  return {
    listForUser: vi.fn(async () => subs),
    removeGone: vi.fn(async () => undefined),
    markUsed: vi.fn(async () => undefined),
  } satisfies PushStore;
}

/** A web-push style rejection: WebPushError carries the endpoint in its message and fields. */
function pushError(statusCode: number, n: number) {
  return Object.assign(new Error(`Received unexpected response code ${sub(n).endpoint}`), {
    statusCode,
    endpoint: sub(n).endpoint,
    body: 'gone',
  });
}

let warn: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetPushWarningsForTests();
  webPushSend.mockReset();
  createPushStore.mockReset();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

/** Everything logged during the test, to check nothing sensitive leaked (NFR-SEC-11). */
function logged(): string {
  return JSON.stringify([...warn.mock.calls, ...error.mock.calls]);
}

describe('sendPushToUser', () => {
  it('sends the payload to every device with the VAPID keys, and records deliveries', async () => {
    const store = fakeStore([sub(1), sub(2)]);
    const send = vi.fn(async () => ({ statusCode: 201, body: '', headers: {} }));

    const result = await sendPushToUser(
      USER,
      PING,
      { urgency: 'high' },
      { vapid: VAPID, store, send },
    );

    expect(result).toEqual({ ok: true, devices: 2, delivered: 2, removed: 0, failed: 0 });
    expect(store.listForUser).toHaveBeenCalledWith(USER);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledWith(
      { endpoint: sub(1).endpoint, keys: { p256dh: 'p256dh-1', auth: 'auth-1' } },
      expect.any(String),
      expect.objectContaining({
        vapidDetails: VAPID,
        TTL: DEFAULT_PUSH_TTL_SECONDS,
        urgency: 'high',
      }),
    );
    const body: unknown = (send.mock.calls[0] as unknown[] | undefined)?.[1];
    expect(JSON.parse(String(body))).toEqual(PING);
    expect(store.markUsed).toHaveBeenCalledWith(['sub-1', 'sub-2']);
    expect(store.removeGone).toHaveBeenCalledWith([]);
    expect(logged()).toBe('[]');
  });

  it('removes subscriptions the push service reports gone (404/410) and keeps the rest', async () => {
    const store = fakeStore([sub(1), sub(2), sub(3), sub(4), sub(5)]);
    const send = vi.fn(async (s: { endpoint: string }) => {
      if (s.endpoint === sub(2).endpoint) throw pushError(410, 2);
      if (s.endpoint === sub(3).endpoint) throw pushError(404, 3);
      if (s.endpoint === sub(4).endpoint) throw pushError(429, 4);
      if (s.endpoint === sub(5).endpoint) throw new Error(`socket hang up ${sub(5).endpoint}`);
      return { statusCode: 201, body: '', headers: {} };
    });

    const result = await sendPushToUser(USER, PING, {}, { vapid: VAPID, store, send });

    expect(result).toEqual({ ok: true, devices: 5, delivered: 1, removed: 2, failed: 2 });
    expect(store.removeGone).toHaveBeenCalledWith(['sub-2', 'sub-3']);
    expect(store.markUsed).toHaveBeenCalledWith(['sub-1']);
    // Only statuses are logged: no endpoint, key, user id or ping text.
    expect(warn).toHaveBeenCalledWith('Web Push: some deliveries failed', {
      statuses: [429, 'network'],
    });
    for (const secret of ['SECRET-ENDPOINT', 'SECRET PING TEXT', 'p256dh-', 'auth-', USER])
      expect(logged()).not.toContain(secret);
  });

  it('with no devices, sends nothing (the inbox is all they get, NFR-COMPAT-2)', async () => {
    const store = fakeStore([]);
    const send = vi.fn();
    expect(await sendPushToUser(USER, PING, {}, { vapid: VAPID, store, send })).toEqual({
      ok: true,
      devices: 0,
      delivered: 0,
      removed: 0,
      failed: 0,
    });
    expect(send).not.toHaveBeenCalled();
  });

  it('uses web-push by default', async () => {
    const store = fakeStore([sub(1)]);
    webPushSend.mockResolvedValue({ statusCode: 201, body: '', headers: {} });
    await sendPushToUser(USER, PING, {}, { vapid: VAPID, store });
    expect(webPushSend).toHaveBeenCalledTimes(1);
  });

  it('passes TTL and topic through', async () => {
    const store = fakeStore([sub(1)]);
    const send = vi.fn(async () => ({ statusCode: 201, body: '', headers: {} }));
    await sendPushToUser(
      USER,
      PING,
      { ttlSeconds: 0, topic: 'ping-1' },
      { vapid: VAPID, store, send },
    );
    expect(send).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      expect.objectContaining({ TTL: 0, topic: 'ping-1' }),
    );
  });

  describe('missing VAPID configuration (fails clearly and safely)', () => {
    it('skips sending, warns once naming the missing variables, never throws', async () => {
      vi.stubEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY', '');
      vi.stubEnv('VAPID_PRIVATE_KEY', '');
      vi.stubEnv('VAPID_SUBJECT', '');
      const store = fakeStore([sub(1)]);
      const send = vi.fn();

      for (let i = 0; i < 3; i++)
        expect(await sendPushToUser(USER, PING, {}, { store, send })).toEqual({
          ok: false,
          reason: 'not_configured',
        });

      expect(send).not.toHaveBeenCalled();
      expect(store.listForUser).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toMatch(
        /NEXT_PUBLIC_VAPID_PUBLIC_KEY is not set.*VAPID_PRIVATE_KEY is not set.*VAPID_SUBJECT is not set/,
      );
    });

    it('does not log a malformed private key', async () => {
      vi.stubEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY', VAPID.publicKey);
      vi.stubEnv('VAPID_PRIVATE_KEY', 'SECRET-BAD-PRIVATE-KEY');
      vi.stubEnv('VAPID_SUBJECT', VAPID.subject);
      const result = await sendPushToUser(USER, PING, {}, { store: fakeStore([sub(1)]) });
      expect(result).toEqual({ ok: false, reason: 'not_configured' });
      expect(logged()).toContain('VAPID_PRIVATE_KEY is not a VAPID private key');
      expect(logged()).not.toContain('SECRET-BAD-PRIVATE-KEY');
    });

    it('is also not configured without the Supabase secret key', async () => {
      createPushStore.mockReturnValue({ ok: false, problems: ['SUPABASE_SECRET_KEY is not set'] });
      const result = await sendPushToUser(USER, PING, {}, { vapid: VAPID });
      expect(result).toEqual({ ok: false, reason: 'not_configured' });
      expect(logged()).toContain('SUPABASE_SECRET_KEY is not set');
    });
  });

  it('refuses a recipient that is not a users.id, before reading anything', async () => {
    const store = fakeStore([sub(1)]);
    for (const bad of ['', 'user_2abc', "'; drop table users; --"])
      expect(await sendPushToUser(bad, PING, {}, { vapid: VAPID, store })).toEqual({
        ok: false,
        reason: 'invalid_recipient',
      });
    expect(store.listForUser).not.toHaveBeenCalled();
  });

  it('refuses an invalid payload or topic without logging its content', async () => {
    const store = fakeStore([sub(1)]);
    const send = vi.fn();
    const bad = { ...PING, url: 'https://evil.test/SECRET PING TEXT' };
    expect(await sendPushToUser(USER, bad, {}, { vapid: VAPID, store, send })).toEqual({
      ok: false,
      reason: 'invalid_payload',
    });
    expect(
      await sendPushToUser(USER, PING, { topic: 'not a topic!' }, { vapid: VAPID, store, send }),
    ).toEqual({ ok: false, reason: 'invalid_payload' });
    expect(send).not.toHaveBeenCalled();
    expect(logged()).not.toContain('SECRET PING TEXT');
  });

  it('a store failure is reported, not thrown', async () => {
    const store = fakeStore([sub(1)]);
    store.listForUser.mockRejectedValue(new Error('push_subscriptions read failed (57014)'));
    expect(await sendPushToUser(USER, PING, {}, { vapid: VAPID, store, send: vi.fn() })).toEqual({
      ok: false,
      reason: 'store_error',
    });
  });

  it('still reports the deliveries when cleanup fails', async () => {
    const store = fakeStore([sub(1), sub(2)]);
    store.removeGone.mockRejectedValue(new Error('push_subscriptions delete failed (08006)'));
    const send = vi.fn(async (s: { endpoint: string }) => {
      if (s.endpoint === sub(2).endpoint) throw pushError(410, 2);
      return { statusCode: 201, body: '', headers: {} };
    });
    expect(await sendPushToUser(USER, PING, {}, { vapid: VAPID, store, send })).toEqual({
      ok: true,
      devices: 2,
      delivered: 1,
      removed: 0,
      failed: 0,
    });
    expect(logged()).not.toContain('SECRET-ENDPOINT');
  });
});
