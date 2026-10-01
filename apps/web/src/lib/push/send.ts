// Sending Web Push notifications from the Next.js server (WF-091; FR-PING-3, NFR-COMPAT-2,
// NFR-SEC-11, D41). Not wired to anything yet: WF-092 calls it when a ping is sent.
//
// WHO MAY BE NOTIFIED (read this before calling sendPushToUser):
//   Postgres decides, not this module. Only call sendPushToUser with a recipient id that came
//   back from a database function that authorised the notification as the acting user, e.g.
//   WF-092's `send_ping` (run through createServerSupabase(), so as the sender) returns the
//   ping and its recipient only after checking the connection, blocks, dnd/paused, mutes and
//   rate limits (FR-PING-1, FR-PING-6, FR-PING-7). Scheduled notifications (WF-115 reminders)
//   come from a cron route that checks CRON_SECRET and reads recipients from a SQL function.
//   Never pass an id taken straight from the request.
//
// Delivery reads the recipient's subscriptions with the narrow secret-key store in
// lib/push/store.ts, because RLS (correctly) never lets the sender read them. The endpoints and
// keys stay on the server; no user can read anyone else's devices through the Data API.
//
// Push is best-effort: sendPushToUser never throws, and the in-app inbox is the source of
// truth (NFR-COMPAT-2). Call it after the response where possible, e.g.
//   import { after } from 'next/server';
//   after(() => sendPushToUser(recipientId, payload, { urgency: 'high' }));
//
// Logging (NFR-SEC-11): only counts, HTTP statuses and the names of missing variables. Never
// an endpoint, a key, a user id, the payload or a web-push error message (those can contain
// the endpoint).

import 'server-only';
import webpush from 'web-push';
import type { PushPayload } from './payload';
import { serializePushPayload } from './payload';
import { readVapidConfig } from './config';
import type { VapidConfig } from './config';
import { createPushStore } from './store';
import type { PushStore, StoredPushSubscription } from './store';

export interface SendPushOptions {
  /**
   * How long the push service keeps the message while the device is offline, in seconds.
   * Defaults to 2 hours, when a ping expires (FR-PING-9). 0 = deliver now or never.
   */
  ttlSeconds?: number;
  /** Delivery priority. Pings should use 'high' so they arrive while the phone sleeps. */
  urgency?: 'very-low' | 'low' | 'normal' | 'high';
  /**
   * Replaces a still-undelivered message with the same topic at the push service (up to 32
   * base64url characters, e.g. a hash of the ping id). Use the payload's `tag` to replace an
   * already-shown notification.
   */
  topic?: string;
}

export type PushSendResult =
  | {
      ok: false;
      /** not_configured: VAPID or Supabase variables missing (logged once, by name). */
      reason: 'not_configured' | 'invalid_payload' | 'invalid_recipient' | 'store_error';
    }
  | {
      ok: true;
      /** Devices the user had. 0 means push is off everywhere: the inbox is all they get. */
      devices: number;
      delivered: number;
      /** Subscriptions deleted because the push service said they no longer exist. */
      removed: number;
      /** Other failures (network, 429, 5xx, ...). Those subscriptions are kept for next time. */
      failed: number;
    };

/** What sendPushToUser uses; tests pass fakes. */
export interface PushDeps {
  vapid: VapidConfig;
  store: PushStore;
  send: typeof webpush.sendNotification;
}

/** Default TTL: a ping is only useful for 2 hours (FR-PING-9). */
export const DEFAULT_PUSH_TTL_SECONDS = 2 * 60 * 60;

/** Push service answers meaning "this subscription is gone for good" (RFC 8030 §7.3). */
const GONE_STATUSES = new Set([404, 410]);

/** Socket timeout per delivery, so one slow push service can't hold the others up. */
const SEND_TIMEOUT_MS = 10_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOPIC = /^[A-Za-z0-9_-]{1,32}$/;

let warnedNotConfigured = false;

function warnNotConfigured(problems: string[]): void {
  if (warnedNotConfigured) return;
  warnedNotConfigured = true;
  console.warn(`Web Push is not configured, skipping notifications: ${problems.join('; ')}`);
}

/** Resets the once-only warning. Tests only. */
export function resetPushWarningsForTests(): void {
  warnedNotConfigured = false;
}

function resolveDeps(
  deps: Partial<PushDeps>,
): { ok: true; deps: PushDeps } | { ok: false; problems: string[] } {
  const problems: string[] = [];
  let vapid = deps.vapid;
  if (!vapid) {
    const read = readVapidConfig();
    if (read.ok) vapid = read.config;
    else problems.push(...read.problems);
  }
  let store = deps.store;
  if (!store) {
    const created = createPushStore();
    if (created.ok) store = created.store;
    else problems.push(...created.problems);
  }
  if (!vapid || !store) return { ok: false, problems };
  return { ok: true, deps: { vapid, store, send: deps.send ?? webpush.sendNotification } };
}

function statusOf(error: unknown): number | null {
  const status = (error as { statusCode?: unknown } | null)?.statusCode;
  return typeof status === 'number' ? status : null;
}

/**
 * Sends `payload` to every device of `userId` and removes the ones the push service reports
 * as gone (404/410). Never throws. See the header of this file for who may be notified.
 */
export async function sendPushToUser(
  userId: string,
  payload: PushPayload,
  options: SendPushOptions = {},
  deps: Partial<PushDeps> = {},
): Promise<PushSendResult> {
  if (!UUID.test(userId)) return { ok: false, reason: 'invalid_recipient' };

  let body: string;
  try {
    body = serializePushPayload(payload);
  } catch {
    console.error('Web Push payload rejected: it does not match lib/push/payload.ts');
    return { ok: false, reason: 'invalid_payload' };
  }
  if (options.topic !== undefined && !TOPIC.test(options.topic)) {
    console.error('Web Push topic rejected: use up to 32 base64url characters');
    return { ok: false, reason: 'invalid_payload' };
  }

  const resolved = resolveDeps(deps);
  if (!resolved.ok) {
    warnNotConfigured(resolved.problems);
    return { ok: false, reason: 'not_configured' };
  }
  const { vapid, store, send } = resolved.deps;

  let subscriptions: StoredPushSubscription[];
  try {
    subscriptions = await store.listForUser(userId);
  } catch (error) {
    // The store's own messages carry only a SQLSTATE.
    console.error('Web Push: could not read subscriptions', (error as Error).message);
    return { ok: false, reason: 'store_error' };
  }

  const ttl = Math.max(0, Math.floor(options.ttlSeconds ?? DEFAULT_PUSH_TTL_SECONDS));
  const results = await Promise.allSettled(
    subscriptions.map((s) =>
      send({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, {
        vapidDetails: vapid,
        TTL: ttl,
        urgency: options.urgency ?? 'normal',
        ...(options.topic ? { topic: options.topic } : {}),
        timeout: SEND_TIMEOUT_MS,
      }),
    ),
  );

  const delivered: string[] = [];
  const gone: string[] = [];
  const failedStatuses: (number | 'network')[] = [];
  results.forEach((result, i) => {
    const id = subscriptions[i]?.id;
    if (id === undefined) return;
    if (result.status === 'fulfilled') {
      delivered.push(id);
      return;
    }
    const status = statusOf(result.reason);
    if (status !== null && GONE_STATUSES.has(status)) gone.push(id);
    else failedStatuses.push(status ?? 'network');
  });

  let removed = 0;
  try {
    await store.removeGone(gone);
    removed = gone.length;
  } catch (error) {
    console.error('Web Push: could not remove gone subscriptions', (error as Error).message);
  }
  try {
    await store.markUsed(delivered);
  } catch (error) {
    console.error('Web Push: could not record deliveries', (error as Error).message);
  }

  if (failedStatuses.length > 0) {
    // Statuses only: 401/403 usually mean the VAPID keys changed since the device subscribed.
    console.warn('Web Push: some deliveries failed', { statuses: failedStatuses });
  }

  return {
    ok: true,
    devices: subscriptions.length,
    delivered: delivered.length,
    removed,
    failed: failedStatuses.length,
  };
}
