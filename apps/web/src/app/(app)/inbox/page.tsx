import type { Metadata } from 'next';
import Link from 'next/link';
import { BellRing, Inbox as InboxIcon, Send } from 'lucide-react';
import { EmptyState } from '@whosfree/ui/components/misc';
import { GroupEmoji, PersonAvatar } from '@whosfree/ui/components/person-avatar';
import { formatAgo, formatDuration } from '@whosfree/ui/lib/time';
import { cn } from '@whosfree/ui/lib/utils';
import { PageHeader } from '@/components/app/page-header';
import { PingMenu, PingReplyBox } from '@/components/inbox/ping-reply';
import { getInbox } from '@/lib/data/inbox';
import { getNow } from '@/lib/data/people';
import type { Ping } from '@/lib/types';

export const metadata: Metadata = { title: 'Inbox' };

// Inbox (WF-092, WF-093). Pings always land here, even without push (NFR-COMPAT-2).
export default async function InboxPage({ searchParams }: PageProps<'/inbox'>) {
  const [{ tab }, inbox, { now }] = await Promise.all([searchParams, getInbox(), getNow()]);
  const showSent = tab === 'sent';
  const list = showSent ? inbox.sent : inbox.received;

  return (
    <>
      <PageHeader title="Inbox" subtitle="Pings expire after 2 hours." />
      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        <nav
          aria-label="Inbox"
          className="flex gap-0.5 self-start rounded-[10px] bg-segment p-[3px]"
        >
          {(
            [
              ['received', 'Received', inbox.received.length],
              ['sent', 'Sent', inbox.sent.length],
            ] as const
          ).map(([key, label, n]) => {
            const active = (key === 'sent') === showSent;
            return (
              <Link
                key={key}
                href={key === 'sent' ? '/inbox?tab=sent' : '/inbox'}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex min-h-10 items-center gap-2 rounded-lg px-4 text-[13.5px] font-semibold text-muted-foreground md:min-h-8',
                  active && 'bg-card text-foreground shadow-[0_1px_2px_rgb(23_21_42/0.12)]',
                )}
              >
                {label}
                <span className="text-xs text-muted-foreground">{n}</span>
              </Link>
            );
          })}
        </nav>

        {/* TODO(WF-091): ask for push permission through an explanation screen (FR-PWA-4). */}
        <p className="flex items-start gap-2 rounded-xl border bg-card p-3 text-[13px] text-body-foreground">
          <BellRing aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary-ink" />
          Turn on notifications in Settings to hear about pings straight away. They&apos;ll always
          show up here too.
        </p>

        {list.length ? (
          <ul className="flex flex-col gap-3">
            {list.map((p) => (
              <PingCard key={p.id} ping={p} now={now} sent={showSent} />
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

function PingCard({ ping, now, sent }: { ping: Ping; now: string; sent: boolean }) {
  const expiresIn = Math.round((Date.parse(ping.expiresAt) - Date.parse(now)) / 60_000);
  const expired = expiresIn <= 0;
  const other = sent ? ping.to : ping.from;
  const otherName = 'group' in other ? other.group.name : other.name;
  const first = otherName.split(' ')[0] ?? otherName;

  return (
    <li
      className={cn(
        'flex flex-col gap-3 rounded-2xl border bg-card p-4',
        !ping.read && !sent && 'border-primary/40 ring-1 ring-primary/20',
      )}
    >
      <div className="flex items-start gap-3">
        {'group' in other ? (
          <GroupEmoji emoji={other.group.emoji} />
        ) : (
          <PersonAvatar name={other.name} hue={other.hue} />
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <p className="text-sm">
            {sent ? (
              <>
                You pinged <span className="font-semibold">{otherName}</span>
              </>
            ) : (
              <>
                <span className="font-semibold">{otherName}</span> pinged you
              </>
            )}
            {!ping.read && !sent ? <span className="sr-only"> (new)</span> : null}
          </p>
          <p className="text-xs text-muted-foreground">
            {formatAgo(ping.sentAt, now)} ·{' '}
            {expired ? 'Expired' : `expires in ${formatDuration(Math.max(expiresIn, 1))}`}
          </p>
        </div>
        {!sent && !('group' in other) ? (
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
          ping.reply?.length ? (
            <ul className="flex flex-col gap-1 text-sm">
              {ping.reply.map((r) => (
                <li key={r.from.id}>
                  <span className="font-semibold">{r.from.name.split(' ')[0]}:</span>{' '}
                  <span className="[overflow-wrap:anywhere]">{r.reply ?? r.text}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No reply yet.</p>
          )
        ) : ping.reply?.length ? (
          <p className="text-sm text-status-free-ink">
            You replied:{' '}
            <span className="font-semibold">{ping.reply[0]?.reply ?? ping.reply[0]?.text}</span>
          </p>
        ) : expired ? (
          <p className="text-sm text-muted-foreground">This ping has expired.</p>
        ) : (
          <PingReplyBox pingId={ping.id} />
        )}
      </div>
    </li>
  );
}
