import * as React from 'react';
import type { SourceType } from '@whosfree/shared';
import { CalendarDays, FileText, PenLine, TriangleAlert, type LucideIcon } from 'lucide-react';
import { cn } from '@whosfree/ui/lib/utils';
import { formatClockRange } from '@whosfree/ui/lib/time';

/** A time range in the design's mono style, e.g. "9:00 – 10:30 AM". Takes local minutes. */
export function TimeRange({
  start,
  end,
  className,
}: {
  start: number;
  end: number;
  className?: string;
}) {
  return (
    <span className={cn('font-mono text-[11px] font-medium whitespace-nowrap', className)}>
      {formatClockRange(start, end)}
    </span>
  );
}

const SOURCES: Record<SourceType, { label: string; icon: LucideIcon; className: string }> = {
  upload: { label: 'Upload', icon: FileText, className: 'text-source-upload' },
  manual: { label: 'Manual', icon: PenLine, className: 'text-source-manual' },
  gcal: { label: 'Google', icon: CalendarDays, className: 'text-source-gcal' },
};

/** Where an event came from (FR-VIEW-5): uploaded schedule, manual entry or Google Calendar. */
export function SourceBadge({ source, className }: { source: SourceType; className?: string }) {
  const s = SOURCES[source];
  const Icon = s.icon;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md bg-card/80 px-1.5 py-0.5 text-[10.5px] font-semibold',
        s.className,
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-3" />
      <span>
        <span className="sr-only">Source: </span>
        {s.label}
      </span>
    </span>
  );
}

/** Stale-data flag (FR-VIEW-8, D25). Healthy data shows nothing at all. */
export function StaleWarning({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-xs font-medium text-status-soon-ink',
        className,
      )}
    >
      <TriangleAlert aria-hidden="true" className="size-3.5" />
      Schedule may be out of date
    </span>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-3 rounded-xl border border-dashed bg-card px-6 py-10 text-center',
        className,
      )}
    >
      <span className="flex size-11 items-center justify-center rounded-full bg-primary-soft text-primary-ink">
        <Icon aria-hidden="true" className="size-5" />
      </span>
      <div className="flex flex-col gap-1">
        <p className="font-semibold">{title}</p>
        {children ? <div className="text-sm text-muted-foreground">{children}</div> : null}
      </div>
      {action}
    </div>
  );
}

/** The design's logo mark: purple tile, white dot with a green ring. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-primary',
        className,
      )}
    >
      <span className="size-3 rounded-full bg-white shadow-[0_0_0_4px_var(--brand-green)]" />
    </span>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <LogoMark />
      <span className="text-[19px] font-bold tracking-[-0.02em]">Who&apos;s Free</span>
    </span>
  );
}

/** Small uppercase section label from the design ("GROUPS", "TODAY"). */
export function Eyebrow({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase',
        className,
      )}
    >
      {children}
    </span>
  );
}
