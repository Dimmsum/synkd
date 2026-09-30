'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { Route } from 'next';
import { DAYS_OF_WEEK, DEFAULT_AVAILABLE_HOURS } from '@whosfree/shared';
import { Moon, Sun } from 'lucide-react';
import { Button } from '@whosfree/ui/components/button';
import { Slider } from '@whosfree/ui/components/slider';
import { formatClock } from '@whosfree/ui/lib/time';
import { saveAvailableHours } from '@/lib/actions/settings';

const toMin = (t: string) => {
  const [h, m] = t.split(':').map(Number) as [number, number];
  return h * 60 + m;
};
const toHHMM = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** "When are you usually up and about?" pre-set to 08:00–22:00 every day (D24). */
export function HoursSlider({ next }: { next: Route }) {
  const router = useRouter();
  const [range, setRange] = useState<[number, number]>([
    toMin(DEFAULT_AVAILABLE_HOURS.start),
    toMin(DEFAULT_AVAILABLE_HOURS.end),
  ]);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-2xl border bg-card p-5 sm:p-6">
        <p className="mb-6 text-center text-3xl font-bold tracking-[-0.02em]" aria-live="polite">
          {formatClock(range[0])} – {formatClock(range[1] === 1440 ? 1439 : range[1])}
        </p>
        <div className="flex items-center gap-3">
          <Sun aria-hidden="true" className="size-5 shrink-0 text-status-soon-ink" />
          <Slider
            min={5 * 60}
            max={24 * 60 - 30}
            step={30}
            minStepsBetweenThumbs={2}
            value={range}
            onValueChange={(v) => setRange([v[0] ?? range[0], v[1] ?? range[1]])}
            thumbLabels={['Up from', 'Done by']}
            valueText={formatClock}
            className="py-3"
          />
          <Moon aria-hidden="true" className="size-5 shrink-0 text-status-away-ink" />
        </div>
        <p className="mt-5 text-center text-sm text-muted-foreground">
          Every day. You can change each day later in Settings.
        </p>
      </div>
      <p className="text-sm text-body-foreground">
        Outside these hours you show as <strong>Away</strong>, so nobody thinks you&apos;re free at
        3 AM.
      </p>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <Button
        size="lg"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await saveAvailableHours(
              DAYS_OF_WEEK.map((day) => ({
                day,
                enabled: true,
                start: toHHMM(range[0]),
                end: toHHMM(range[1]),
              })),
            );
            if (res.ok) router.push(next);
            else setError(res.error);
          })
        }
      >
        Continue
      </Button>
    </div>
  );
}
