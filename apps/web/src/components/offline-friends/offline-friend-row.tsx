import Link from 'next/link';
import type { Route } from 'next';
import { Upload } from 'lucide-react';
import { buttonVariants } from '@whosfree/ui/components/button';
import { PersonAvatar } from '@whosfree/ui/components/person-avatar';
import { StatusBadge, StatusMarker, type StatusTone } from '@whosfree/ui/components/status-badge';
import { cn } from '@whosfree/ui/lib/utils';
import { hueFor } from '@/lib/hue';
import { describeOfflineStatus } from '@/lib/offline-friends';
import type { OfflineFriendView } from '@/lib/types';

/** An offline friend's page (WF-128). */
export const offlineFriendHref = (id: string) => `/friends/offline/${id}` as Route;

/** Upload their timetable: the import flow for this offline friend (WF-127). */
export const offlineUploadHref = (id: string) =>
  `/import?friend=${encodeURIComponent(id)}` as Route;

/** Type their schedule in: manual entry for this offline friend (WF-127). */
export const offlineManualHref = (id: string) =>
  `/import/manual/review?friend=${encodeURIComponent(id)}` as Route;

/**
 * An offline friend's emoji on a soft disc, or their initials when they have none, with an
 * optional status marker. Decorative: the nickname is always shown next to it.
 */
export function OfflineAvatar({
  friend,
  size = 'md',
  status,
}: {
  friend: Pick<OfflineFriendView, 'id' | 'nickname' | 'emoji'>;
  size?: 'sm' | 'md' | 'xl';
  status?: StatusTone;
}) {
  if (!friend.emoji) {
    return (
      <PersonAvatar
        name={friend.nickname}
        hue={hueFor(friend.id)}
        size={size}
        {...(status ? { status } : {})}
      />
    );
  }
  return (
    <span aria-hidden="true" className="relative inline-flex shrink-0">
      <span
        className={cn(
          'flex items-center justify-center rounded-full bg-status-off-soft',
          { sm: 'size-7 text-sm', md: 'size-9 text-lg', xl: 'size-18 text-4xl' }[size],
        )}
      >
        {friend.emoji}
      </span>
      {status ? <StatusMarker tone={status} /> : null}
    </span>
  );
}

/** The small "Not on whosfree" label, so they're never mistaken for an account (FR-SOC-17). */
export function NotOnWhosfreeTag({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground',
        className,
      )}
    >
      Not on whosfree
    </span>
  );
}

/**
 * One offline friend with their status and "until X" (WF-128). The nickname links to their
 * page. There's no Ping button: they aren't on whosfree (FR-SOC-17). Without a schedule, the
 * action is to add one.
 */
export function OfflineFriendRow({
  friend,
  now,
  timeZone,
  showTag = false,
  className,
}: {
  friend: OfflineFriendView;
  now: string;
  timeZone: string;
  /** Show "Not on whosfree" next to the nickname. */
  showTag?: boolean;
  className?: string;
}) {
  const s = describeOfflineStatus(friend, now, timeZone);
  return (
    <li
      className={cn(
        'relative flex items-center gap-3 rounded-xl px-2 py-2.5 transition-colors has-[a:hover]:bg-background',
        className,
      )}
    >
      <OfflineAvatar friend={friend} status={s.tone} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-2 text-[14.5px]">
          <Link
            href={offlineFriendHref(friend.id)}
            className="truncate font-semibold underline-offset-2 after:absolute after:inset-0 hover:underline"
          >
            {friend.nickname}
          </Link>
          {showTag ? <NotOnWhosfreeTag /> : null}
        </div>
        <StatusBadge tone={s.tone}>{s.label}</StatusBadge>
        {s.detail ? <span className="text-xs text-muted-foreground">{s.detail}</span> : null}
      </div>
      {friend.status === 'no_schedule' ? (
        <div className="relative z-10 shrink-0">
          <Link
            href={offlineUploadHref(friend.id)}
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
            aria-label={`Add ${friend.nickname}’s schedule`}
          >
            <Upload aria-hidden="true" />
            Add schedule
          </Link>
        </div>
      ) : null}
    </li>
  );
}
