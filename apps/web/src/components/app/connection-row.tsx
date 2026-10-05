import Link from 'next/link';
import { PersonAvatar } from '@synkd/ui/components/person-avatar';
import { StaleWarning } from '@synkd/ui/components/misc';
import { StatusBadge } from '@synkd/ui/components/status-badge';
import { cn } from '@synkd/ui/lib/utils';
import type { Connection } from '@/lib/types';
import { describeStatus } from '@/lib/status';
import { PingButton } from './ping-dialog';

/**
 * One person with their status and "until X" (D18). The name links to the friend's
 * detail page; Ping/Nudge are separate buttons so there are no nested controls.
 */
export function ConnectionRow({
  c,
  now,
  timeZone,
  soon = false,
  context,
  showActions = true,
  className,
}: {
  c: Connection;
  now: string;
  timeZone: string;
  soon?: boolean;
  /** Extra line, e.g. "In Netball Crew" for people who aren't friends. */
  context?: string;
  showActions?: boolean;
  className?: string;
}) {
  const s = describeStatus(c, now, timeZone, { soon });
  const name = c.isFriend ? (
    <Link
      href={`/friends/${c.id}`}
      className="truncate font-semibold underline-offset-2 after:absolute after:inset-0 hover:underline"
    >
      {c.name}
    </Link>
  ) : (
    <span className="truncate font-semibold">{c.name}</span>
  );

  return (
    <li
      className={cn(
        'relative flex items-center gap-3 rounded-xl px-2 py-2.5 transition-colors has-[a:hover]:bg-background',
        className,
      )}
    >
      <PersonAvatar name={c.name} hue={c.hue} status={s.tone} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-2 text-[14.5px]">{name}</div>
        <StatusBadge tone={s.tone}>{s.label}</StatusBadge>
        {s.detail || context || c.stale ? (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            {s.detail ? <span>{s.detail}</span> : null}
            {context ? <span>{context}</span> : null}
            {c.stale ? <StaleWarning /> : null}
          </div>
        ) : null}
      </div>
      {showActions ? (
        <div className="relative z-10 shrink-0">
          {/* TODO(WF-069): a NudgeButton for 'no_schedule' once nudges are sent (WF-134). */}
          {c.status === 'no_schedule' || c.status === 'paused' ? null : (
            <PingButton
              target={{
                kind: 'person',
                id: c.id,
                name: c.name,
                status: c.status,
                statusLabel: s.label,
              }}
              variant={c.status === 'free' ? 'soft' : 'outline'}
            />
          )}
        </div>
      ) : null}
    </li>
  );
}
