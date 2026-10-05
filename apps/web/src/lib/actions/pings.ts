'use server';

// Pings (WF-092) and replies (WF-093). Postgres decides everything (D41): `send_ping` and
// `reply_to_ping` run as the signed-in user, check the connection, blocks, the recipient's
// status (FR-PING-1) and the rate limit, and return the one user who may be notified. Only then
// does the server send Web Push, after the response (WF-091, lib/push/send.ts). The inbox is
// the source of truth either way (NFR-COMPAT-2).
//
// Logging (NFR-SEC-11): error codes only. Never ping text, names, ids or tokens.

import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import {
  PING_REPLIES,
  PING_TEMPLATES,
  PingText,
  type PingReply,
  type PingTemplate,
} from '@synkd/shared';
import { createServerSupabase } from '@/lib/supabase/server';
import { sendPushToUser } from '@/lib/push/send';
import { pingError } from '@/lib/pings/errors';
import { pingPushPayload, replyPushPayload } from '@/lib/pings/push';
import { isUuid } from '@/lib/social/mappers';
import { failFrom, refreshSocial } from '@/lib/social/server';
import { TRY_AGAIN, type DbError } from '@/lib/social/errors';
import { fail, ok, type ActionResult } from './result';

/** What sendPing returns: `needsConfirmation` asks the sender "Ping anyway?" (FR-PING-1). */
export type SendPingResult = { ok: true } | { ok: false; error: string; needsConfirmation?: true };

/** At most this many ids per mark-as-read call (list_inbox returns at most 200). */
const MAX_MARK_READ = 200;

/** Free text as the database will store it: CRLF → LF, trimmed; undefined when blank. */
function cleanText(text: string | undefined): string | undefined {
  const cleaned = text?.replace(/\r\n/g, '\n').trim();
  return cleaned ? cleaned : undefined;
}

function pingFailure(
  fn: string,
  error: DbError,
): { ok: false; error: string; needsConfirmation?: true } {
  const known = pingError(error);
  if (!known) {
    console.error(`${fn} failed`, error.code ?? 'no code');
    return fail(TRY_AGAIN);
  }
  return known.needsConfirmation
    ? { ok: false, error: known.message, needsConfirmation: true }
    : fail(known.message);
}

/**
 * Pings someone (J3, FR-PING-1, FR-PING-2): a template, up to 140 characters of plain text, or
 * both. `confirmed` is true once the sender answered "Ping anyway?" for someone who isn't free;
 * without it the server refuses busy/away/no-schedule recipients with `needsConfirmation`.
 */
export async function sendPing(input: {
  to: { personId: string } | { groupId: string };
  template?: PingTemplate;
  text?: string;
  confirmed?: boolean;
}): Promise<SendPingResult> {
  const text = cleanText(input.text);
  if (!input.template && !text) return fail('Pick a message or write one.');
  if (input.template && !PING_TEMPLATES.includes(input.template)) return fail('Unknown template.');
  if (text && !PingText.safeParse(text).success) {
    return fail('Keep it to 140 characters of plain text.');
  }
  if ('groupId' in input.to) {
    // TODO(WF-096, FR-PING-5): group ping to every free member, with the groupPing permission.
    return fail('Group pings aren’t available yet. Ping people one at a time for now.');
  }
  const recipient = input.to.personId;
  if (!isUuid(recipient)) return fail('We couldn’t find that person.');

  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc('send_ping', {
    recipient,
    template: input.template,
    message: text,
    confirmed: input.confirmed === true,
  });
  if (error) return pingFailure('send_ping', error);
  const row = data[0];
  if (!row) {
    console.error('send_ping returned no row');
    return fail(TRY_AGAIN);
  }

  // Only the recipient the database returned, and only when it says so (WF-094 mutes and
  // quiet hours will turn `notify` off; the ping is in their inbox regardless).
  if (row.notify) {
    const payload = pingPushPayload({
      pingId: row.ping_id,
      senderName: row.sender_name,
      template: input.template,
      text,
    });
    after(() => sendPushToUser(row.recipient_id, payload, { urgency: 'high' }));
  }
  revalidatePath('/inbox');
  return ok;
}

/**
 * Replies to a ping you received (FR-PING-4): one tap (`reply`) or short plain text, not both.
 * The sender is notified. A reply is final.
 */
export async function replyToPing(input: {
  pingId: string;
  reply?: PingReply;
  text?: string;
}): Promise<ActionResult> {
  const text = input.reply ? undefined : cleanText(input.text);
  if (input.reply && !PING_REPLIES.includes(input.reply)) return fail('Unknown reply.');
  if (!input.reply && !(text && PingText.safeParse(text).success)) {
    return fail('Write a reply of up to 140 characters.');
  }
  if (!isUuid(input.pingId)) return fail('This ping isn’t there any more.');

  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc('reply_to_ping', {
    ping_id: input.pingId,
    reply: input.reply,
    message: text,
  });
  if (error) return pingFailure('reply_to_ping', error);
  const row = data[0];
  if (!row) {
    console.error('reply_to_ping returned no row');
    return fail(TRY_AGAIN);
  }

  if (row.notify) {
    const payload = replyPushPayload({
      pingId: input.pingId,
      replierName: row.replier_name,
      reply: input.reply,
      text,
    });
    after(() => sendPushToUser(row.sender_id, payload, { urgency: 'high' }));
  }
  revalidatePath('/inbox');
  return ok;
}

/**
 * Marks pings shown in the inbox as read: received ones, and replies to sent ones. Called by
 * the inbox after it renders, so it deliberately doesn't revalidate: that would re-render the
 * open inbox and drop the "new" highlight the viewer is looking at. The badge in the app
 * layout catches up on the next navigation (the layout is rendered per request).
 */
export async function markPingsRead(pingIds: string[]): Promise<ActionResult> {
  const ids = Array.isArray(pingIds) ? pingIds.filter((id) => isUuid(id)) : [];
  if (ids.length === 0) return ok;
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc('mark_pings_read', {
    ping_ids: ids.slice(0, MAX_MARK_READ),
  });
  if (error) return pingFailure('mark_pings_read', error);
  return ok;
}

/**
 * Not built yet, so it says so instead of reporting a success (WF-134). The inbox doesn't offer
 * it until it is.
 */
export async function reportPing(_pingId: string): Promise<ActionResult> {
  // TODO(FR-PING-8, WF-095): send the ping with context to the moderation queue (a `reports`
  // row referencing pings.id).
  return fail('Reporting isn’t available yet. You can block them instead.');
}

/**
 * Blocks the sender silently (FR-SOC-6, WF-047): they aren't told, any friendship or request
 * ends, and they can no longer find, ping or invite the viewer. Their pings leave the inbox
 * (list_inbox hides blocked people). Stays on the current page.
 */
export async function blockPerson(personId: string): Promise<ActionResult> {
  if (!isUuid(personId)) return fail('We couldn’t find that person.');
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc('block_user', { user_id: personId });
  if (error) return failFrom('block_user', error);
  refreshSocial();
  return ok;
}

/** Not built yet, so it says so instead of reporting a success (WF-134); nothing offers it. */
export async function nudgeToAddSchedule(_personId: string): Promise<ActionResult> {
  // TODO(WF-069): "Nudge them to add a schedule" notification (FR-VIEW-7).
  return fail('Nudges aren’t available yet.');
}
