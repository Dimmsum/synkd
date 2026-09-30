'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { Route } from 'next';
import { DAYS_OF_WEEK } from '@whosfree/shared';
import { FileText, Pencil, Plus, Trash, TriangleAlert } from 'lucide-react';
import { Button } from '@whosfree/ui/components/button';
import { Input } from '@whosfree/ui/components/input';
import { Label } from '@whosfree/ui/components/label';
import { formatClockRange } from '@whosfree/ui/lib/time';
import { cn } from '@whosfree/ui/lib/utils';
import { blockPosition, TimeGrid, type GridColumn } from '@/components/calendar/time-grid';
import { confirmSchedule } from '@/lib/actions/imports';
import { CATEGORY_LABELS } from '@/lib/status';
import type { DraftEvent, ParseJob } from '@/lib/types';
import { describeWhen, EventEditorDialog } from './event-editor';

/** Below this the parser wasn't sure (FR-IMP-10). */
export const LOW_CONFIDENCE = 0.7;

const toMin = (t: string) => {
  const [h, m] = t.split(':').map(Number) as [number, number];
  return h * 60 + m;
};
const HOUR = 40;

/**
 * Review a parsed schedule before it's saved (FR-IMP-9/10/11, WF-029). Nothing reaches
 * the schedule until Confirm. The original file sits next to the preview (stacked with a
 * toggle on phones).
 */
export function ReviewEditor({ job, doneHref }: { job: ParseJob; doneHref: Route }) {
  const router = useRouter();
  const [events, setEvents] = useState<DraftEvent[]>(job.events);
  const [period, setPeriod] = useState(job.period);
  const [editing, setEditing] = useState<DraftEvent | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const unsure = events.filter((e) => e.confidence < LOW_CONFIDENCE);
  const manual = !job.fileName;

  const times = events.flatMap((e) => [toMin(e.start), toMin(e.end)]);
  const gridStart = Math.min(8 * 60, ...times.map((t) => Math.floor(t / 60) * 60));
  const gridEnd = Math.max(18 * 60, ...times.map((t) => Math.ceil(t / 60) * 60));

  const columns: GridColumn[] = DAYS_OF_WEEK.map((d) => ({
    key: d,
    header: (
      <div className="py-2 text-center text-[11px] font-semibold tracking-[0.05em] text-muted-foreground uppercase">
        {d}
      </div>
    ),
    children: events
      .filter((e) => e.when.kind === 'weekly' && e.when.days.includes(d))
      .map((e) => {
        const low = e.confidence < LOW_CONFIDENCE;
        return (
          <button
            key={e.id}
            type="button"
            onClick={() => {
              setEditing(e);
              setEditorOpen(true);
            }}
            aria-label={`Edit ${e.title}${low ? ' (we weren’t sure about this one)' : ''}`}
            className={cn(
              'absolute inset-x-0.5 z-10 flex flex-col overflow-hidden rounded-md border px-1.5 py-1 text-left',
              low
                ? 'border-2 border-dashed border-status-soon bg-status-soon-soft'
                : 'border-primary/25 bg-primary-soft',
            )}
            style={blockPosition(toMin(e.start), toMin(e.end), gridStart, HOUR, 1)}
          >
            <span className="flex items-center gap-1 truncate text-[11px] font-semibold">
              {low ? (
                <TriangleAlert
                  aria-hidden="true"
                  className="size-3 shrink-0 text-status-soon-ink"
                />
              ) : null}
              {e.title}
            </span>
          </button>
        );
      }),
  }));

  function confirm() {
    setError(undefined);
    start(async () => {
      const res = await confirmSchedule({
        jobId: job.id,
        events: events.map(({ id: _id, ...rest }) => rest),
        period,
      });
      if (res.ok) router.push(doneHref);
      else setError(res.error);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {unsure.length ? (
        <p className="flex items-start gap-2 rounded-xl bg-status-soon-soft p-3 text-sm text-status-soon-ink">
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          We weren&apos;t sure about {unsure.length === 1 ? 'one event' : `${unsure.length} events`}
          . They have a dashed outline. Check them against your file.
        </p>
      ) : null}

      <div
        className={cn(
          'grid grid-cols-[minmax(0,1fr)] gap-4',
          !manual && 'xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]',
        )}
      >
        {!manual ? (
          <section aria-labelledby="original-title" className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <h2 id="original-title" className="text-[15px] font-semibold">
                Your file
              </h2>
              <Button
                variant="ghost"
                size="sm"
                className="xl:hidden"
                aria-expanded={showOriginal}
                onClick={() => setShowOriginal((s) => !s)}
              >
                {showOriginal ? 'Hide file' : 'Show file'}
              </Button>
            </div>
            {/* TODO(WF-029): show the real file from a short-lived signed URL. */}
            <div
              className={cn(
                'aspect-[3/4] max-h-[520px] flex-col gap-2 rounded-2xl border bg-card p-5',
                showOriginal ? 'flex' : 'hidden xl:flex',
              )}
            >
              <p className="flex items-center gap-2 text-sm font-semibold">
                <FileText aria-hidden="true" className="size-4 text-primary-ink" />
                {job.fileName} · page 1 of 1
              </p>
              <div
                aria-hidden="true"
                className="grid flex-1 grid-cols-6 grid-rows-8 gap-px rounded-lg bg-border p-px"
              >
                {Array.from({ length: 48 }, (_, i) => (
                  <span
                    key={i}
                    className={cn('bg-card', [7, 9, 11, 14, 20, 26, 33].includes(i) && 'bg-muted')}
                  />
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Preview of the original, for comparing.
              </p>
            </div>
          </section>
        ) : null}

        <section aria-labelledby="preview-title" className="flex flex-col gap-2">
          <h2 id="preview-title" className="text-[15px] font-semibold">
            Your week
          </h2>
          <div className="rounded-2xl border bg-card">
            <TimeGrid
              label="Preview of your week"
              columns={columns}
              startMin={gridStart}
              endMin={gridEnd}
              hourHeight={HOUR}
              minColumnWidth={64}
            />
          </div>
        </section>
      </div>

      <section aria-labelledby="events-title" className="rounded-2xl border bg-card p-4 md:p-5">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 id="events-title" className="text-[15px] font-semibold">
            Events ({events.length})
          </h2>
          <Button
            size="sm"
            variant="soft"
            onClick={() => {
              setEditing(null);
              setEditorOpen(true);
            }}
          >
            <Plus aria-hidden="true" />
            Add event
          </Button>
        </div>
        {events.length ? (
          <ul className="flex flex-col divide-y divide-border-subtle">
            {events.map((e) => (
              <li key={e.id} className="flex items-center gap-3 py-2.5">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex items-center gap-2 text-sm font-semibold">
                    {e.title}
                    {e.confidence < LOW_CONFIDENCE ? (
                      <span className="flex items-center gap-1 rounded-full bg-status-soon-soft px-2 text-[11px] font-semibold text-status-soon-ink">
                        <TriangleAlert aria-hidden="true" className="size-3" /> Not sure
                      </span>
                    ) : null}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {CATEGORY_LABELS[e.category]} · {describeWhen(e)} ·{' '}
                    <span className="font-mono">
                      {formatClockRange(toMin(e.start), toMin(e.end))}
                    </span>
                  </span>
                </span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Edit ${e.title}`}
                  onClick={() => {
                    setEditing(e);
                    setEditorOpen(true);
                  }}
                >
                  <Pencil aria-hidden="true" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Delete ${e.title}`}
                  onClick={() => setEvents(events.filter((x) => x.id !== e.id))}
                >
                  <Trash aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="py-4 text-sm text-muted-foreground">
            No events yet. Add your classes, shifts or anything else that makes you busy.
          </p>
        )}
        {/* TODO(WF-029): split and merge events (FR-IMP-11). */}
      </section>

      <section aria-labelledby="period-title" className="rounded-2xl border bg-card p-4 md:p-5">
        <h2 id="period-title" className="text-[15px] font-semibold">
          When does this schedule run?
        </h2>
        <p className="mb-3 text-xs text-muted-foreground">
          {manual ? 'Pick the dates it covers.' : 'We found these dates in your file. Check them.'}
        </p>
        <div className="grid max-w-md grid-cols-2 gap-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="period-start">From</Label>
            <Input
              id="period-start"
              type="date"
              value={period.start}
              onChange={(e) => setPeriod({ ...period, start: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="period-end">Until</Label>
            <Input
              id="period-end"
              type="date"
              value={period.end}
              onChange={(e) => setPeriod({ ...period, end: e.target.value })}
            />
          </div>
        </div>
        {/* TODO(WF-030/FR-IMP-8): exceptions (breaks, exams) with Jamaican public holidays pre-filled. */}
      </section>

      {error ? (
        <p role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}
      <div className="sticky bottom-20 z-20 flex flex-col gap-2 rounded-2xl border bg-card/95 p-3 backdrop-blur sm:flex-row sm:items-center sm:justify-between md:bottom-4">
        <p className="text-xs text-muted-foreground">
          {manual
            ? 'Nothing is saved until you confirm.'
            : 'Nothing is saved until you confirm. Your file is deleted as soon as you do.'}
        </p>
        <Button onClick={confirm} disabled={pending}>
          Confirm schedule
        </Button>
      </div>

      <EventEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        event={editing}
        onSave={(saved) => {
          setEvents((prev) =>
            prev.some((x) => x.id === saved.id)
              ? prev.map((x) => (x.id === saved.id ? saved : x))
              : [...prev, saved],
          );
          setEditorOpen(false);
        }}
      />
    </div>
  );
}
