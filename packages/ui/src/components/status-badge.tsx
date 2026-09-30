import * as React from 'react';
import type { Status } from '@whosfree/shared';
import {
  BellOff,
  CalendarClock,
  CalendarPlus,
  CircleCheck,
  CirclePause,
  Hourglass,
  Moon,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@whosfree/ui/lib/utils';

/**
 * A status as the UI shows it. `soon` is not a stored status: it's a `busy`/`away`/`dnd`
 * person who becomes free within the hour (the Now screen's "Free soon" section).
 */
export type StatusTone = Status | 'soon';

interface ToneStyle {
  icon: LucideIcon;
  /** Short word for screen readers and compact chips. */
  word: string;
  ink: string;
  soft: string;
  solid: string;
}

// Status is never shown by colour alone (NFR-UX-1): each tone has its own icon and word.
export const STATUS_TONES: Record<StatusTone, ToneStyle> = {
  free: {
    icon: CircleCheck,
    word: 'Free',
    ink: 'text-status-free-ink',
    soft: 'bg-status-free-soft',
    solid: 'bg-status-free',
  },
  soon: {
    icon: Hourglass,
    word: 'Free soon',
    ink: 'text-status-soon-ink',
    soft: 'bg-status-soon-soft',
    solid: 'bg-status-soon',
  },
  busy: {
    icon: CalendarClock,
    word: 'Busy',
    ink: 'text-status-busy-ink',
    soft: 'bg-status-busy-soft',
    solid: 'bg-status-busy',
  },
  dnd: {
    icon: BellOff,
    word: 'Do not disturb',
    ink: 'text-status-dnd-ink',
    soft: 'bg-status-dnd-soft',
    solid: 'bg-status-dnd',
  },
  away: {
    icon: Moon,
    word: 'Away',
    ink: 'text-status-away-ink',
    soft: 'bg-status-away-soft',
    solid: 'bg-status-away',
  },
  no_schedule: {
    icon: CalendarPlus,
    word: 'No schedule yet',
    ink: 'text-status-off-ink',
    soft: 'bg-status-off-soft',
    solid: 'bg-status-off',
  },
  paused: {
    icon: CirclePause,
    word: 'Sharing paused',
    ink: 'text-status-off-ink',
    soft: 'bg-status-off-soft',
    solid: 'bg-status-off',
  },
};

export function StatusIcon({
  tone,
  className,
  ...props
}: { tone: StatusTone } & React.ComponentProps<'svg'>) {
  const Icon = STATUS_TONES[tone].icon;
  return <Icon aria-hidden="true" className={cn('size-4 shrink-0', className)} {...props} />;
}

/**
 * Icon + text in the status colour, e.g. "✓ Free until 4:30 PM".
 * `variant="pill"` adds the soft background used for chips.
 */
export function StatusBadge({
  tone,
  children,
  variant = 'text',
  truncate = false,
  className,
}: {
  tone: StatusTone;
  children?: React.ReactNode;
  variant?: 'text' | 'pill';
  /** Cut long labels with an ellipsis instead of wrapping. */
  truncate?: boolean;
  className?: string;
}) {
  const t = STATUS_TONES[tone];
  return (
    <span
      data-status={tone}
      className={cn(
        'inline-flex min-w-0 items-start gap-1.5 text-[13px] leading-5 font-semibold',
        t.ink,
        variant === 'pill' && ['items-center rounded-full px-2.5 py-1', t.soft],
        className,
      )}
    >
      <StatusIcon tone={tone} className="mt-[3px] size-3.5" />
      <span className={cn(truncate && 'truncate')}>{children ?? t.word}</span>
    </span>
  );
}

/** The small status marker on an avatar: a coloured disc with the status icon inside. */
export function StatusMarker({ tone, className }: { tone: StatusTone; className?: string }) {
  const t = STATUS_TONES[tone];
  const Icon = t.icon;
  return (
    <span
      aria-hidden="true"
      className={cn(
        'absolute -right-0.5 -bottom-0.5 flex size-4 items-center justify-center rounded-full ring-2 ring-card',
        t.solid,
        className,
      )}
    >
      <Icon className="size-2.5 text-white" strokeWidth={3} />
    </span>
  );
}
