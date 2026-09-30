import * as React from 'react';
import { cn } from '@whosfree/ui/lib/utils';
import { StatusMarker, type StatusTone } from '@whosfree/ui/components/status-badge';

const SIZES = {
  xs: 'size-5 text-[8px]',
  sm: 'size-7 text-[10px]',
  md: 'size-9 text-[11px]',
  lg: 'size-12 text-sm',
  xl: 'size-18 text-xl',
} as const;

/** Colour for a person, from a stable hue (0–360). Mid lightness keeps white initials legible. */
export function personColor(hue: number) {
  return `oklch(0.6 0.13 ${hue})`;
}

export function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

/**
 * Initials avatar in the design's style. It's decorative (`aria-hidden`): the person's
 * name is always shown or announced next to it. Pass `status` to add the status marker.
 */
export function PersonAvatar({
  name,
  hue,
  size = 'md',
  status,
  className,
}: {
  name: string;
  hue: number;
  size?: keyof typeof SIZES;
  status?: StatusTone;
  className?: string;
}) {
  return (
    <span aria-hidden="true" className={cn('relative inline-flex shrink-0', className)}>
      <span
        className={cn(
          'flex items-center justify-center rounded-full font-bold text-white',
          SIZES[size],
        )}
        style={{ background: personColor(hue) }}
      >
        {initialsOf(name)}
      </span>
      {status ? <StatusMarker tone={status} /> : null}
    </span>
  );
}

/** Overlapping avatars, e.g. who's free in a slot. */
export function AvatarStack({
  people,
  max = 5,
  size = 'sm',
  className,
}: {
  people: { id: string; name: string; hue: number }[];
  max?: number;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const shown = people.slice(0, max);
  const extra = people.length - shown.length;
  return (
    <span aria-hidden="true" className={cn('flex items-center pl-1.5', className)}>
      {shown.map((p) => (
        <PersonAvatar
          key={p.id}
          name={p.name}
          hue={p.hue}
          size={size}
          className="-ml-1.5 rounded-full ring-2 ring-card"
        />
      ))}
      {extra > 0 ? (
        <span className="-ml-1.5 flex size-7 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground ring-2 ring-card">
          +{extra}
        </span>
      ) : null}
    </span>
  );
}

/** A group's emoji on a soft tile (FR-SOC-2: groups have a name and an emoji). */
export function GroupEmoji({
  emoji,
  size = 'md',
  className,
}: {
  emoji: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex shrink-0 items-center justify-center rounded-[10px] bg-primary-soft',
        size === 'sm' && 'size-7 text-sm',
        size === 'md' && 'size-10 text-lg',
        size === 'lg' && 'size-14 rounded-2xl text-2xl',
        className,
      )}
    >
      {emoji}
    </span>
  );
}
