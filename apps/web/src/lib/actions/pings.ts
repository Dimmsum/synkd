'use server';

// Pings (WF-092) and replies (WF-093). Stubs: validate, then pretend it worked.

import {
  ManualStatus,
  PING_REPLIES,
  PING_TEMPLATES,
  PingText,
  type PingReply,
  type PingTemplate,
} from '@whosfree/shared';
import { fail, mockDelay, ok, type ActionResult } from './result';

export async function sendPing(input: {
  to: { personId: string } | { groupId: string };
  template?: PingTemplate;
  text?: string;
}): Promise<ActionResult> {
  if (!input.template && !input.text?.trim()) return fail('Pick a message or write one.');
  if (input.template && !PING_TEMPLATES.includes(input.template)) return fail('Unknown template.');
  if (input.text?.trim() && !PingText.safeParse(input.text).success) {
    return fail('Keep it to 140 characters.');
  }
  // TODO(WF-092): call the send_ping function. The server re-checks FR-PING-1 (dnd/paused
  // blocked), rate limits (FR-PING-6) and, for groups, the groupPing permission (FR-PING-5),
  // then sends Web Push. Never log the text (NFR-SEC-11).
  await mockDelay();
  return ok;
}

export async function replyToPing(input: {
  pingId: string;
  reply?: PingReply;
  text?: string;
}): Promise<ActionResult> {
  if (input.reply && !PING_REPLIES.includes(input.reply)) return fail('Unknown reply.');
  if (!input.reply && !PingText.safeParse(input.text ?? '').success) {
    return fail('Write a reply of up to 140 characters.');
  }
  // TODO(WF-093): save the reply and notify the sender.
  await mockDelay();
  return ok;
}

export async function reportPing(_pingId: string): Promise<ActionResult> {
  // TODO(FR-PING-8, WF-095): send the ping with context to the moderation queue.
  await mockDelay();
  return ok;
}

export async function blockPerson(_personId: string): Promise<ActionResult> {
  // TODO(WF-047): block silently; they aren't told (FR-SOC-6).
  await mockDelay();
  return ok;
}

export async function nudgeToAddSchedule(_personId: string): Promise<ActionResult> {
  // TODO(WF-069): "Nudge them to add a schedule" notification (FR-VIEW-7).
  await mockDelay();
  return ok;
}

export async function setManualStatus(input: {
  status: ManualStatus | null;
  /** ISO instant, or null for "until I change it". */
  until: string | null;
}): Promise<ActionResult> {
  if (input.status !== null && !ManualStatus.safeParse(input.status).success) {
    return fail('Unknown status.');
  }
  // TODO(WF-063): write/clear the statusOverrides row (null = back to automatic).
  await mockDelay();
  return ok;
}
