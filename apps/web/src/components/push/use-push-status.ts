'use client';

import { useEffect, useState } from 'react';
import { detectPushSupport, readPushEnvironment, sameServerKey } from '@/lib/push/capability';
import type { PushSupport } from '@/lib/push/capability';
import { currentSubscription, resyncPush } from '@/lib/push/client';

/**
 * Push on this device (WF-091): `loading` until the browser has been checked (so the server
 * render and the first client render match), then why push can't work here, or whether it's
 * on. `no-service-worker` is only reported after trying to turn push on.
 */
export type PushStatus =
  'loading' | Exclude<PushSupport, 'supported'> | 'no-service-worker' | 'denied' | 'off' | 'on';

/** Reads the current state. Never prompts for permission (FR-PWA-4). */
async function readStatus(resync: boolean): Promise<PushStatus> {
  const env = readPushEnvironment();
  const support = detectPushSupport(env);
  if (support !== 'supported') return support;
  if (Notification.permission === 'denied') return 'denied';
  const sub = await currentSubscription();
  if (
    !sub ||
    Notification.permission !== 'granted' ||
    !env.vapidPublicKey ||
    !sameServerKey(sub.options.applicationServerKey, env.vapidPublicKey)
  ) {
    return 'off';
  }
  if (resync) void resyncPush(sub);
  return 'on';
}

/**
 * @param resync re-save an existing subscription (heals a device the server dropped). Only
 *   for the settings/onboarding card, not for every page view.
 */
export function usePushStatus({ resync = false }: { resync?: boolean } = {}) {
  const [status, setStatus] = useState<PushStatus>('loading');

  useEffect(() => {
    let cancelled = false;
    readStatus(resync)
      .catch((): PushStatus => 'unsupported')
      .then((next) => {
        if (!cancelled) setStatus(next);
      });
    return () => {
      cancelled = true;
    };
  }, [resync]);

  return { status, setStatus };
}
