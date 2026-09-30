import type { EventCategory, Status } from '@whosfree/shared';
import type { StatusTone } from '@whosfree/ui/components/status-badge';
import { formatUntil, type Instant } from '@whosfree/ui/lib/time';
import type { Activity, Connection } from '@/lib/types';

/** How a T2 viewer sees each category (PRD §6.7: "In class", "At work", "In a meeting"). */
export const CATEGORY_PHRASES: Record<EventCategory, string> = {
  class: 'In class',
  lab: 'In a lab',
  tutorial: 'In a tutorial',
  work: 'At work',
  meeting: 'In a meeting',
  event: 'Busy',
  other: 'Busy',
};

/** Short label for a category, for blocks on timelines. */
export const CATEGORY_LABELS: Record<EventCategory, string> = {
  class: 'Class',
  lab: 'Lab',
  tutorial: 'Tutorial',
  work: 'Work',
  meeting: 'Meeting',
  event: 'Calendar event',
  other: 'Busy',
};

export interface StatusText {
  tone: StatusTone;
  /** Main line, e.g. "In class until 3:00 PM". */
  label: string;
  /** Optional second line, e.g. the category under a T3 title. */
  detail?: string;
}

/** Label for a busy block at the viewer's tier: title (T3), category (T2) or just "Busy". */
export function activityLabel(activity: Activity | undefined): string {
  if (activity?.title) return activity.title;
  if (activity?.category) return CATEGORY_LABELS[activity.category];
  return 'Busy';
}

function busyText(activity: Activity | undefined, until: string): StatusText {
  if (activity?.title) {
    const c = activity.category;
    return {
      tone: 'busy',
      label: `${activity.title} until ${until}`,
      detail: c ? (c === 'event' ? 'Calendar event' : CATEGORY_PHRASES[c]) : undefined,
    };
  }
  if (activity?.category === 'event') {
    return { tone: 'busy', label: `Busy until ${until}`, detail: 'Calendar event' };
  }
  const phrase = activity?.category ? CATEGORY_PHRASES[activity.category] : 'Busy';
  return { tone: 'busy', label: `${phrase} until ${until}` };
}

const NOW_WORDS: Partial<Record<Status, string>> = {
  busy: 'Busy now',
  away: 'Away now',
  dnd: 'Do not disturb',
};

/**
 * The words for someone's status (D18: every status shows "until X"). The activity has
 * already been redacted to the viewer's tier by the server, so T1 never has one.
 * With `soon`, describes a Free-soon person ("Free from 3:00 PM").
 */
export function describeStatus(
  c: Pick<Connection, 'status' | 'until' | 'nextFreeAt' | 'activity'>,
  now: Instant,
  timeZone: string,
  opts: { soon?: boolean } = {},
): StatusText {
  const fmt = (i: string | null) => (i ? formatUntil(i, now, timeZone) : '');

  if (opts.soon && c.nextFreeAt) {
    const why =
      c.status === 'busy' && c.activity
        ? (c.activity.title ??
          (c.activity.category ? CATEGORY_PHRASES[c.activity.category] : undefined))
        : undefined;
    return {
      tone: 'soon',
      label: `Free from ${fmt(c.nextFreeAt)}`,
      detail: why ?? NOW_WORDS[c.status],
    };
  }

  switch (c.status) {
    case 'free':
      return { tone: 'free', label: c.until ? `Free until ${fmt(c.until)}` : 'Free' };
    case 'busy':
      return busyText(c.activity, fmt(c.until));
    case 'dnd':
      return { tone: 'dnd', label: `Do not disturb until ${fmt(c.until)}` };
    case 'away':
      return { tone: 'away', label: `Away until ${fmt(c.until)}` };
    case 'no_schedule':
      return { tone: 'no_schedule', label: 'Hasn’t added a schedule yet' };
    case 'paused':
      return { tone: 'paused', label: 'Sharing paused' };
  }
}
