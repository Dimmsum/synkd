'use client';

// Client-side behaviour of the inbox (WF-092, WF-093): live refresh on the viewer's Realtime
// channel, marking what's shown as read, and finishing a one-tap reply chosen on a
// notification. None of these render data of their own; the server page does.

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { INBOX_CHANGED_EVENT } from '@whosfree/shared';
import { useRefetch, useUserSignals } from '@/components/realtime/use-user-signals';
import { markPingsRead, replyToPing } from '@/lib/actions/pings';
import {
  QUICK_REPLY_CACHE,
  parsePendingQuickReply,
  quickReplyPath,
  type PendingQuickReply,
} from '@/lib/push/quick-reply';

/**
 * Re-fetches the inbox when a ping or reply arrives: the database sends an empty
 * `inbox_changed` Broadcast on the viewer's private channel (D41), and the server page then
 * reads `list_inbox` again. Also refreshes when the app comes back to the foreground, in case
 * a signal was missed while the phone slept.
 */
export function InboxLive({ viewerId }: { viewerId: string }) {
  const refetch = useRefetch();
  useUserSignals(viewerId, INBOX_CHANGED_EVENT, refetch, 'Inbox');

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') refetch();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refetch]);

  return null;
}

/** Marks the shown unread pings (or unread replies) as read, once each. */
export function MarkPingsRead({ ids }: { ids: string[] }) {
  const done = useRef(new Set<string>());
  const key = ids.join(',');

  useEffect(() => {
    const fresh = key.split(',').filter((id) => id && !done.current.has(id));
    if (fresh.length === 0) return;
    for (const id of fresh) done.current.add(id);
    void markPingsRead(fresh);
  }, [key]);

  return null;
}

async function takePendingQuickReply(key: string): Promise<PendingQuickReply | null> {
  const path = quickReplyPath(key);
  if (!path || typeof caches === 'undefined') return null;
  try {
    const cache = await caches.open(QUICK_REPLY_CACHE);
    const response = await cache.match(path);
    if (!response) return null;
    // One use only, whatever happens next.
    await cache.delete(path);
    return parsePendingQuickReply(await response.json(), Date.now());
  } catch {
    return null;
  }
}

/**
 * Sends the one-tap reply picked on a notification's action button (FR-PING-4, see
 * lib/push/quick-reply.ts). `quickKey` is the `?quick=` parameter; it does nothing unless this
 * browser's service worker stored a reply under it moments ago.
 */
export function QuickReplyFromNotification({ quickKey }: { quickKey?: string }) {
  const router = useRouter();
  const handled = useRef<string | null>(null);
  const [status, setStatus] = useState<{ ok: boolean; text: string }>();

  useEffect(() => {
    if (!quickKey || handled.current === quickKey) return;
    handled.current = quickKey;
    void (async () => {
      const pending = await takePendingQuickReply(quickKey);
      router.replace('/inbox', { scroll: false });
      if (!pending) return;
      const res = await replyToPing({ pingId: pending.pingId, reply: pending.reply });
      setStatus(
        res.ok ? { ok: true, text: `Replied “${pending.reply}”.` } : { ok: false, text: res.error },
      );
    })();
  }, [quickKey, router]);

  if (!status) return null;
  return (
    <p
      role={status.ok ? 'status' : 'alert'}
      className={
        status.ok
          ? 'rounded-xl bg-status-free-soft p-3 text-sm font-medium text-status-free-ink'
          : 'rounded-xl bg-destructive/10 p-3 text-sm font-medium text-destructive'
      }
    >
      {status.text}
    </p>
  );
}
