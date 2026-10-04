import { describe, expect, it, vi } from 'vitest';
import { subscribeUserSignals, type SignalChannel, type SignalClient } from './subscribe';

type Status = Parameters<Parameters<SignalChannel['subscribe']>[0]>[0];

/** A fake client that records the order of `setAuth` and `subscribe`. */
function fakeClient(setAuth: () => Promise<void> = async () => {}) {
  const calls: string[] = [];
  let report: (status: Status) => void = () => {};
  let signal: () => void = () => {};
  const channel: SignalChannel = {
    on: (_type, _filter, cb) => {
      signal = cb;
      return channel;
    },
    subscribe: (cb) => {
      calls.push('subscribe');
      report = cb;
      return channel;
    },
  };
  const client: SignalClient = {
    realtime: {
      setAuth: vi.fn(async () => {
        calls.push('setAuth:start');
        await setAuth();
        calls.push('setAuth:done');
      }),
    },
    channel: vi.fn(() => channel),
    removeChannel: vi.fn(async () => 'ok'),
  };
  return { client, calls, report: (s: Status) => report(s), signal: () => signal() };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function options() {
  return { topic: 'user:1', event: 'now_changed', onChange: vi.fn(), onProblem: vi.fn() };
}

describe('subscribeUserSignals (WF-133)', () => {
  it('has the token before it joins, so the first join is authorised', async () => {
    let release!: () => void;
    const f = fakeClient(() => new Promise<void>((r) => (release = r)));
    subscribeUserSignals(f.client, options());
    await flush();
    expect(f.calls).toEqual(['setAuth:start']);
    release();
    await flush();
    expect(f.calls).toEqual(['setAuth:start', 'setAuth:done', 'subscribe']);
    expect(f.client.channel).toHaveBeenCalledWith('user:1', { config: { private: true } });
  });

  it('passes signals on, and does not refetch on a clean first join', async () => {
    const f = fakeClient();
    const o = options();
    subscribeUserSignals(f.client, o);
    await flush();
    f.report('SUBSCRIBED');
    expect(o.onChange).not.toHaveBeenCalled();
    f.signal();
    expect(o.onChange).toHaveBeenCalledTimes(1);
  });

  it('catches up on the first join that follows a refused one', async () => {
    const f = fakeClient();
    const o = options();
    subscribeUserSignals(f.client, o);
    await flush();
    f.report('CHANNEL_ERROR');
    expect(o.onProblem).toHaveBeenCalledWith('CHANNEL_ERROR');
    f.report('SUBSCRIBED');
    expect(o.onChange).toHaveBeenCalledTimes(1);
  });

  it('catches up after a reconnect', async () => {
    const f = fakeClient();
    const o = options();
    subscribeUserSignals(f.client, o);
    await flush();
    f.report('SUBSCRIBED');
    f.report('SUBSCRIBED');
    expect(o.onChange).toHaveBeenCalledTimes(1);
  });

  it('still joins when the token cannot be fetched', async () => {
    const f = fakeClient(async () => {
      throw new Error('offline');
    });
    const o = options();
    subscribeUserSignals(f.client, o);
    await flush();
    expect(o.onProblem).toHaveBeenCalledWith('auth');
    expect(f.calls).toContain('subscribe');
  });

  it('never joins when stopped before the token arrives, and leaves after joining', async () => {
    let release!: () => void;
    const f = fakeClient(() => new Promise<void>((r) => (release = r)));
    const stop = subscribeUserSignals(f.client, options());
    stop();
    release();
    await flush();
    expect(f.calls).not.toContain('subscribe');

    const g = fakeClient();
    const stopG = subscribeUserSignals(g.client, options());
    await flush();
    stopG();
    expect(g.client.removeChannel).toHaveBeenCalledTimes(1);
  });
});
