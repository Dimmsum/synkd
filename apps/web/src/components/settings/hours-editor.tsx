'use client';

import { useState, useTransition } from 'react';
import { AvailableHours, type DayOfWeek } from '@synkd/shared';
import { CopyCheck } from 'lucide-react';
import { Button } from '@synkd/ui/components/button';
import { Input } from '@synkd/ui/components/input';
import { Switch } from '@synkd/ui/components/switch';
import { cn } from '@synkd/ui/lib/utils';
import { saveAvailableHours } from '@/lib/actions/settings';
import type { AvailableHoursDay } from '@/lib/types';

const DAY_NAMES: Record<DayOfWeek, string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
};

/** Checks one day with the shared schema (end after start). */
export function dayError(d: AvailableHoursDay): string | undefined {
  if (!d.enabled) return undefined;
  return AvailableHours.safeParse({ day: d.day, start: d.start, end: d.end }).success
    ? undefined
    : 'End must be after start';
}

/**
 * Available hours, editable per day (FR-AVL-2, WF-062): outside them you show as Away,
 * so nobody looks "free" at 3 AM. Switching a day off means Away all day.
 */
export function HoursEditor({ initial }: { initial: AvailableHoursDay[] }) {
  const [days, setDays] = useState(initial);
  const [status, setStatus] = useState<string>();
  const [pending, start] = useTransition();
  const errors = days.map(dayError);
  const update = (i: number, patch: Partial<AvailableHoursDay>) => {
    setStatus(undefined);
    setDays((prev) => prev.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  };

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col divide-y divide-border-subtle">
        {days.map((d, i) => {
          const name = DAY_NAMES[d.day];
          return (
            <li key={d.day} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
              <label className="flex min-h-11 w-40 items-center gap-3">
                <Switch
                  checked={d.enabled}
                  onCheckedChange={(v) => update(i, { enabled: v })}
                  aria-label={`Available on ${name}`}
                />
                <span className="text-sm font-medium">{name}</span>
              </label>
              {d.enabled ? (
                <div className="flex items-center gap-2">
                  <Input
                    type="time"
                    step={900}
                    value={d.start}
                    onChange={(e) => update(i, { start: e.target.value })}
                    aria-label={`${name} from`}
                    aria-invalid={Boolean(errors[i])}
                    className="w-32 font-mono text-sm"
                  />
                  <span aria-hidden="true" className="text-muted-foreground">
                    –
                  </span>
                  <Input
                    type="time"
                    step={900}
                    value={d.end}
                    onChange={(e) => update(i, { end: e.target.value })}
                    aria-label={`${name} until`}
                    aria-invalid={Boolean(errors[i])}
                    className="w-32 font-mono text-sm"
                  />
                </div>
              ) : (
                <span className="text-sm text-muted-foreground">Away all day</span>
              )}
              {errors[i] ? (
                <span
                  role="alert"
                  className="basis-full text-xs font-medium text-destructive sm:pl-44"
                >
                  {errors[i]}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            const first = days[0];
            if (first)
              setDays(
                days.map((d) => ({
                  ...d,
                  enabled: first.enabled,
                  start: first.start,
                  end: first.end,
                })),
              );
          }}
        >
          <CopyCheck aria-hidden="true" />
          Use Monday for every day
        </Button>
        <Button
          size="sm"
          disabled={pending || errors.some(Boolean)}
          onClick={() =>
            start(async () => {
              const res = await saveAvailableHours(days);
              setStatus(res.ok ? 'Saved' : res.error);
            })
          }
        >
          Save hours
        </Button>
        <span
          role="status"
          className={cn(
            'text-sm',
            status === 'Saved' ? 'text-status-free-ink' : 'text-destructive',
          )}
        >
          {status}
        </span>
      </div>
    </div>
  );
}
