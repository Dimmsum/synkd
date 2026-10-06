// `list_inbox` rows (WF-092) → the inbox view model. Pure. The rows are already filtered by
// the database: nobody blocked either way appears (FR-SOC-6), and each row carries only the
// viewer's own unread flag.

import type { InboxPing } from '@synkd/backend';
import { PING_REPLIES, PING_TEMPLATES, type PingReply, type PingTemplate } from '@synkd/shared';
import { toPerson } from '@/lib/social/mappers';
import type { Ping } from '@/lib/types';

const isTemplate = (t: string | null): t is PingTemplate =>
  t !== null && (PING_TEMPLATES as readonly string[]).includes(t);
const isReply = (r: string | null): r is PingReply =>
  r !== null && (PING_REPLIES as readonly string[]).includes(r);

/** Timestamps come back as ISO strings from PostgREST; normalise to UTC ISO. */
const iso = (t: string) => new Date(t).toISOString();

export function toPing(row: InboxPing): Ping {
  const ping: Ping = {
    id: row.id,
    direction: row.direction,
    other: toPerson({ id: row.other_id, name: row.other_name, handle: row.other_handle }),
    sentAt: iso(row.created_at),
    expiresAt: iso(row.expires_at),
    unread: row.unread,
  };
  if (isTemplate(row.template)) ping.template = row.template;
  if (row.text) ping.text = row.text;
  if (row.replied_at) {
    ping.reply = { at: iso(row.replied_at) };
    if (isReply(row.reply)) ping.reply.reply = row.reply;
    else if (row.reply_text) ping.reply.text = row.reply_text;
  }
  return ping;
}

/** Splits the inbox into the Received and Sent tabs, keeping newest-first order. */
export function splitInbox(rows: InboxPing[]): { received: Ping[]; sent: Ping[] } {
  const received: Ping[] = [];
  const sent: Ping[] = [];
  for (const row of rows) (row.direction === 'received' ? received : sent).push(toPing(row));
  return { received, sent };
}
