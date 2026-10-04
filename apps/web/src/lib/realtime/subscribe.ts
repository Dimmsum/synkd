// Joining the viewer's private Realtime channel for "changed" signals (D41, FR-VIEW-3, WF-064,
// WF-133). Kept apart from the React hook (components/realtime/use-user-signals.ts) so it can be
// tested without a browser.
//
// The join must carry the Clerk token. realtime-js copies the token it holds into the join
// message when `subscribe()` is called, and supabase-js only starts fetching it (asynchronously)
// when the client is created, so subscribing straight away sends a join with no token. Realtime
// refuses that join a few seconds later, realtime-js rejoins with the token, and every signal
// sent in between is lost (WF-133). So the token is fetched first, then the channel is joined.

/** A Realtime subscription status, as realtime-js reports it. */
export type SignalStatus = 'SUBSCRIBED' | 'TIMED_OUT' | 'CLOSED' | 'CHANNEL_ERROR';

/** The part of a Supabase browser client this needs (lib/supabase/browser.ts). */
export interface SignalClient<C extends SignalChannel = SignalChannel> {
  realtime: { setAuth(token?: string | null): Promise<void> };
  channel(topic: string, opts: { config: { private: true } }): C;
  removeChannel(channel: C): Promise<unknown>;
}

export interface SignalChannel {
  on(type: 'broadcast', filter: { event: string }, callback: () => void): SignalChannel;
  subscribe(callback: (status: `${SignalStatus}`) => void): unknown;
}

export interface SignalOptions {
  topic: string;
  event: string;
  /** Called for every signal, and once after any join that follows a failed or lost one. */
  onChange: () => void;
  /** Called with a status only, never an error object (NFR-SEC-11). */
  onProblem: (status: 'auth' | 'CHANNEL_ERROR' | 'TIMED_OUT') => void;
}

/**
 * Fetches the token, then joins `topic` and calls `onChange` for every `event` signal. Signals
 * sent while not joined are lost, so a join that follows a dropped connection or a failed first
 * attempt calls `onChange` once to catch up. Returns a function that leaves the channel.
 */
export function subscribeUserSignals<C extends SignalChannel>(
  supabase: SignalClient<C>,
  { topic, event, onChange, onProblem }: SignalOptions,
): () => void {
  let stopped = false;
  let channel: C | null = null;

  void (async () => {
    try {
      // No argument: reads the token through the client's `accessToken` callback.
      await supabase.realtime.setAuth();
    } catch {
      // Join anyway: realtime-js fetches the token again and rejoins on its own.
      onProblem('auth');
    }
    if (stopped) return;

    let joined = false;
    let missed = false;
    channel = supabase.channel(topic, { config: { private: true } });
    channel
      .on('broadcast', { event }, () => onChange())
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          if (joined || missed) onChange();
          joined = true;
          missed = false;
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          missed = true;
          onProblem(status);
        }
      });
  })();

  return () => {
    stopped = true;
    if (channel) void supabase.removeChannel(channel);
  };
}
