import type { Metadata } from 'next';
import Link from 'next/link';
import { Inbox as InboxIcon, Send } from 'lucide-react';
import { EmptyState } from '@whosfree/ui/components/misc';
import { PersonAvatar } from '@whosfree/ui/components/person-avatar';
import { formatAgo, formatDuration } from '@whosfree/ui/lib/time';
import { cn } from '@whosfree/ui/lib/utils';
import { PageHeader } from '@/components/app/page-header';
import {
  InboxLive,
  MarkPingsRead,
  QuickReplyFromNotification,
} from '@/components/inbox/inbox-live';
import { PingMenu, PingReplyBox } from '@/components/inbox/ping-reply';
import { PushInboxHint } from '@/components/push/push-permission';
import { getInbox } from '@/lib/data/inbox';
import { getViewerRow } from '@/lib/data/now';
import { getNow } from '@/lib/data/people';
import { QUICK_REPLY_PARAM } from '@/lib/push/quick-reply';
import type { Ping } from '@/lib/types';

export const metadata: Metadata = { title: 'Inbox' };

// Inbox (WF-092, WF-093). Pings always land here, even without push (NFR-COMPAT-2). Live: a
// ping or reply for the viewer re-fetches this page (InboxLive, `inbox_changed`).
export default async function InboxPage({ searchParams }: PageProps<'/inbox'>) {
  const [params, inbox, viewer, { now }] = await Promise.all([
    searchParams,
    getInbox(),
    getViewerRow(),
    getNow(),
  ]);
  const showSent = params.tab === 'sent';
  const list = showSent ? inbox.sent : inbox.received;
  const quick = params[QUICK_REPLY_PARAM];
  const unreadIds = list.filter((p) => p.unread).map((p) => p.id);

  return (
    <>
      <PageHeader title="Inbox" subtitle="Pings expire after 2 hours." />
      <InboxLive viewerId={viewer.id} />
      <MarkPingsRead ids={unreadIds} />
      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        <QuickReplyFromNotification quickKey={typeof quick === 'string' ? quick : undefined} />
        <nav
          aria-label="Inbox"
          className="flex gap-0.5 self-start rounded-[10px] bg-segment p-[3px]"
        >
          {(
            [
              ['received', 'Received', inbox.received],
              ['sent', 'Sent', inbox.sent],
            ] as const
          ).map(([key, label, pings]) => {
            const active = (key === 'sent') === showSent;
            const unread = pings.filter((p) => p.unread).length;
            return (
              <Link
                key={key}
                href={key === 'sent' ? '/inbox?tab=sent' : '/inbox'}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex min-h-11 items-center gap-2 rounded-lg px-4 text-[13.5px] font-semibold text-body-foreground md:min-h-8',
                  active && 'bg-card text-foreground shadow-[0_1px_2px_rgb(23_21_42/0.12)]',
                )}
              >
                {label}
                <span className="text-xs">{pings.length}</span>
                {unread > 0 && !active ? (
                  <span className="rounded-full bg-primary px-1.5 text-[11px] text-primary-foreground">
                    {unread}
                    <span className="sr-only"> new</span>
                  </span>
                ) : null}
              </Link>
            );
          })}
        </nav>

        {/* The inbox is the fallback for anyone without push (NFR-COMPAT-2, WF-091). The hint
            links to the explanation screen in Settings; it never prompts (FR-PWA-4). */}
        <PushInboxHint />

        {list.length ? (
          <ul className="flex flex-col gap-3">
            {list.map((p) => (
              <PingCard key={p.id} ping={p} now={now} />
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={showSent ? Send : InboxIcon}
            title={showSent ? 'No pings sent yet' : 'No pings yet'}
          >
            {showSent
              ? 'Find someone who’s free on the Now screen and ping them.'
              : 'When a friend pings you, it shows up here.'}
          </EmptyState>
        )}
      </div>
    </>
  );
}

function replyText(reply: NonNullable<Ping['reply']>): string {
  return reply.reply ?? reply.text ?? '';
}

function PingCard({ ping, now }: { ping: Ping; now: string }) {
  const sent = ping.direction === 'sent';
  const expiresIn = Math.round((Date.parse(ping.expiresAt) - Date.parse(now)) / 60_000);
  const expired = expiresIn <= 0;
  const other = ping.other;
  const first = other.name.split(' ')[0] || other.name;

  return (
    <li
      className={cn(
        'flex flex-col gap-3 rounded-2xl border bg-card p-4',
        ping.unread && 'border-primary/40 ring-1 ring-primary/20',
      )}
    >
      <div className="flex items-start gap-3">
        <PersonAvatar name={other.name} hue={other.hue} />
        <div className="flex min-w-0 flex-1 flex-col">
          <p className="text-sm [overflow-wrap:anywhere]">
            {sent ? (
              <>
                You pinged <span className="font-semibold">{other.name}</span>
              </>
            ) : (
              <>
                <span className="font-semibold">{other.name}</span> pinged you
              </>
            )}
            {ping.unread ? (
              <span className="sr-only">{sent ? ' (new reply)' : ' (new)'}</span>
            ) : null}
          </p>
          <p className="text-xs text-muted-foreground">
            {formatAgo(ping.sentAt, now)} ·{' '}
            {expired ? 'Expired' : `expires in ${formatDuration(Math.max(expiresIn, 1))}`}
          </p>
        </div>
        {!sent ? (
          <div className="flex flex-wrap justify-end">
            <PingMenu pingId={ping.id} personId={other.id} name={first} />
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5 pl-12">
        {ping.template ? (
          <p className="w-fit rounded-2xl rounded-tl-md bg-primary-soft px-3.5 py-2 font-semibold text-primary-ink">
            {ping.template}
          </p>
        ) : null}
        {ping.text ? (
          // Plain text only (D31): React escapes it and we never linkify URLs.
          <p className="w-fit max-w-full rounded-2xl rounded-tl-md bg-muted px-3.5 py-2 text-sm whitespace-pre-wrap [overflow-wrap:anywhere]">
            {ping.text}
          </p>
        ) : null}
      </div>

      <div className="pl-12">
        {sent ? (
          ping.reply ? (
            <p className="text-sm">
              <span className="font-semibold">{first}:</span>{' '}
              {/* Plain text (D31), like the ping itself. */}
              <span className="whitespace-pre-wrap [overflow-wrap:anywhere]">
                {replyText(ping.reply)}
              </span>
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">No reply yet.</p>
          )
        ) : ping.reply ? (
          <p className="text-sm text-status-free-ink">
            You replied:{' '}
            <span className="font-semibold whitespace-pre-wrap [overflow-wrap:anywhere]">
              {replyText(ping.reply)}
            </span>
          </p>
        ) : expired ? (
          // TODO(WF-097): the server doesn't refuse late replies yet; the UI stops offering them.
          <p className="text-sm text-muted-foreground">This ping has expired.</p>
        ) : (
          <PingReplyBox pingId={ping.id} />
        )}
      </div>
    </li>
  );
}
