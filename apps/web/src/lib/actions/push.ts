'use server';

// Web Push on this device (WF-091, FR-PWA-4): save or remove the browser's subscription, and
// send a test notification to your own devices. Writes go through database functions as the
// signed-in user (createServerSupabase, RLS); the endpoint and keys are never logged
// (NFR-SEC-11).

import { after } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { DB_ERROR } from '@synkd/backend';
import { PUSH_DEVICE_LABEL_MAX_LENGTH } from '@synkd/shared';
import { createServerSupabase } from '@/lib/supabase/server';
import { sendPushToUser } from '@/lib/push/send';
import { fail, ok, type ActionResult } from './result';

const TRY_AGAIN = 'Something went wrong on our side. Try again.';

/** What the browser's `PushSubscription.toJSON()` gives, plus an optional device label. */
export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  deviceLabel?: string | null;
}

function isInput(input: unknown): input is PushSubscriptionInput {
  const i = input as PushSubscriptionInput | null;
  return (
    typeof i?.endpoint === 'string' &&
    i.endpoint.length <= 2048 &&
    typeof i.keys?.p256dh === 'string' &&
    i.keys.p256dh.length <= 100 &&
    typeof i.keys.auth === 'string' &&
    i.keys.auth.length <= 32 &&
    (i.deviceLabel == null || typeof i.deviceLabel === 'string')
  );
}

async function signedIn(): Promise<boolean> {
  const { userId } = await auth();
  return userId !== null;
}

/** Stores this browser's subscription for the signed-in user. Safe to call again. */
export async function savePushSubscription(input: PushSubscriptionInput): Promise<ActionResult> {
  if (!(await signedIn())) return fail('Sign in to turn on notifications.');
  if (!isInput(input)) return fail('This browser gave us a subscription we can’t use.');

  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc('save_push_subscription', {
    endpoint: input.endpoint,
    p256dh: input.keys.p256dh,
    auth: input.keys.auth,
    // The database drops a blank label; keep an over-long one from failing the save.
    device_label: input.deviceLabel?.slice(0, PUSH_DEVICE_LABEL_MAX_LENGTH) ?? undefined,
  });
  if (!error) return ok;
  if (error.code === DB_ERROR.rateLimited) {
    return fail('You’ve turned on notifications on a lot of devices today. Try again tomorrow.');
  }
  if (error.code === DB_ERROR.noAccount) return fail('Finish signing up first.');
  if (error.code === '22023') return fail('This browser gave us a subscription we can’t use.');
  console.error('save_push_subscription failed', error.code);
  return fail(TRY_AGAIN);
}

/** Removes this browser's subscription for the signed-in user (turn off, sign out). */
export async function deletePushSubscription(endpoint: string): Promise<ActionResult> {
  if (!(await signedIn())) return ok; // Nothing of theirs to remove without a session.
  if (typeof endpoint !== 'string' || endpoint.length > 2048) return ok;

  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc('delete_push_subscription', { endpoint });
  if (!error) return ok;
  console.error('delete_push_subscription failed', error.code);
  return fail(TRY_AGAIN);
}

/**
 * Sends "Notifications are working" to all the signed-in user's devices. The database
 * authorises it (own devices only, 10 an hour) and returns the recipient; delivery runs after
 * the response.
 */
export async function sendTestPush(): Promise<ActionResult> {
  if (!(await signedIn())) return fail('Sign in first.');

  const supabase = await createServerSupabase();
  const { data: recipient, error } = await supabase.rpc('request_test_push');
  if (error) {
    if (error.code === DB_ERROR.rateLimited) return fail('That’s enough tests for now.');
    console.error('request_test_push failed', error.code);
    return fail(TRY_AGAIN);
  }
  after(() =>
    sendPushToUser(
      recipient,
      {
        v: 1,
        kind: 'test',
        title: 'Notifications are working',
        body: 'This is how pings will reach you.',
        url: '/settings/notifications',
        tag: 'test',
      },
      { ttlSeconds: 60 * 60, urgency: 'high' },
    ),
  );
  return ok;
}
