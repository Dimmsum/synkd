'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { Route } from 'next';
import {
  DateRange,
  DAYS_OF_WEEK,
  DEFAULT_TIMEZONE,
  SCHEDULE_EXCEPTION_LABEL_MAX_LENGTH,
} from '@whosfree/shared';
import {
  CalendarOff,
  ExternalLink,
  FileText,
  Info,
  Merge,
  Pencil,
  Plus,
  Scissors,
  Trash,
  TriangleAlert,
  X,
} from 'lucide-react';
import { Button, buttonVariants } from '@whosfree/ui/components/button';
import { Checkbox } from '@whosfree/ui/components/checkbox';
import { Input } from '@whosfree/ui/components/input';
import { Label } from '@whosfree/ui/components/label';
import { dateKey, formatClockRange } from '@whosfree/ui/lib/time';
import { cn } from '@whosfree/ui/lib/utils';
import { blockPosition, TimeGrid, type GridColumn } from '@/components/calendar/time-grid';
import { confirmSchedule } from '@/lib/actions/imports';
import { mergeEvents, splitEvent, splitKind } from '@/lib/draft-edit';
import { formatPeriod } from '@/lib/my-schedule';
import {
  defaultManualPeriod,
  endedMessage,
  formatDateRange,
  periodHasEnded,
  withHolidays,
  type EditableException,
} from '@/lib/schedule-draft';
import { CATEGORY_LABELS } from '@/lib/status';
import type { DraftEvent, OfflineFriendRef, ParseJob } from '@/lib/types';
import { describeWhen, EventEditorDialog } from './event-editor';

/** Below this the parser wasn't sure (FR-IMP-10). */
export const LOW_CONFIDENCE = 0.7;

const toMin = (t: string) => {
  const [h, m] = t.split(':').map(Number) as [number, number];
  return h * 60 + m;
};
const HOUR = 40;

/**
 * Review a parsed schedule before it's saved (FR-IMP-9/10/11, WF-029), or build one from
 * scratch (manual entry, FR-IMP-12, WF-031: a job without a file). Nothing reaches the
 * schedule until Confirm. The original file sits next to the preview (stacked with a toggle on
 * phones). The user sets the dates the schedule covers and its breaks; Jamaican public holidays
 * are pre-filled (FR-IMP-7, FR-IMP-8).
 *
 * Events can be edited, deleted, added, split and merged (FR-IMP-11); low-confidence ones
 * are outlined until they're touched (FR-IMP-10).
 *
 * `replaces` is the confirmed schedule this one replaces, if any (FR-IMP-17), so the user is
 * told before confirming. `offlineFriend` is whose schedule it becomes when it isn't the
 * viewer's (WF-127, D44): a parse job's database row already knows it from the upload; manual
 * entry sends it with the confirm.
 */
export function ReviewEditor({
  job,
  doneHref,
  replaces = null,
  offlineFriend = null,
}: {
  job: ParseJob;
  doneHref: Route;
  replaces?: { start: string; end: string } | null;
  offlineFriend?: OfflineFriendRef | null;
}) {
  const router = useRouter();
  const [events, setEvents] = useState<DraftEvent[]>(job.events);
  const [period, setPeriod] = useState({ start: job.period.start, end: job.period.end });
  const today = dateKey(new Date(), DEFAULT_TIMEZONE);
  const [ownExceptions, setOwnExceptions] = useState<EditableException[]>(
    job.period.exceptions ?? [],
  );
  // Pre-filled holidays the user removed, by date.
  const [dismissed, setDismissed] = useState<string[]>([]);
  const exceptions = withHolidays(ownExceptions, period, dismissed);
  const [editing, setEditing] = useState<DraftEvent | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  // FR-IMP-11: events picked for merging.
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const unsure = events.filter((e) => e.confidence < LOW_CONFIDENCE);
  const manual = !job.fileName;
  const whose = offlineFriend ? `${offlineFriend.nickname}’s` : 'your';
  const picked = events.filter((e) => selected.includes(e.id));
  const merged = picked.length >= 2 ? mergeEvents(picked) : null;

  function split(e: DraftEvent) {
    setEvents((prev) => prev.flatMap((x) => (x.id === e.id ? splitEvent(x) : [x])));
  }

  function mergeSelected() {
    if (!merged) return;
    const at = events.findIndex((e) => selected.includes(e.id));
    setEvents((prev) => {
      const rest = prev.filter((e) => !selected.includes(e.id));
      return [...rest.slice(0, at), merged, ...rest.slice(at)];
    });
    setSelected([]);
    setSelecting(false);
  }

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
        period: {
          ...period,
          exceptions: exceptions.map(({ holiday: _holiday, ...range }) => range),
        },
        offlineFriendId: offlineFriend?.id ?? null,
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
            <div
              className={cn(
                'h-[min(70dvh,560px)] flex-col gap-2 rounded-2xl border bg-card p-3',
                showOriginal ? 'flex' : 'hidden xl:flex',
              )}
            >
              <div className="flex items-center gap-2 px-1">
                <FileText aria-hidden="true" className="size-4 shrink-0 text-primary-ink" />
                <p className="min-w-0 flex-1 truncate text-sm font-semibold">
                  {job.fileName}
                  {job.original?.pages && job.original.pages > 1
                    ? ` · ${job.original.pages} pages`
                    : ''}
                </p>
                {job.original ? (
                  <a
                    href={job.original.url}
                    target="_blank"
                    rel="noreferrer"
                    className={buttonVariants({ variant: 'ghost', size: 'sm' })}
                  >
                    <ExternalLink aria-hidden="true" />
                    Open
                  </a>
                ) : null}
              </div>
              <OriginalFile original={job.original} name={job.fileName} />
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
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 id="events-title" className="text-[15px] font-semibold">
            Events ({events.length})
          </h2>
          <div className="flex flex-wrap gap-2">
            {events.length >= 2 ? (
              <Button
                size="sm"
                variant="ghost"
                aria-pressed={selecting}
                onClick={() => {
                  setSelecting((s) => !s);
                  setSelected([]);
                }}
              >
                <Merge aria-hidden="true" />
                {selecting ? 'Cancel merge' : 'Merge'}
              </Button>
            ) : null}
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
        </div>
        {selecting ? (
          <div
            aria-live="polite"
            className="mb-2 flex flex-col gap-2 rounded-xl bg-primary-soft p-3 text-sm text-primary-ink sm:flex-row sm:items-center sm:justify-between"
          >
            <p>
              {picked.length < 2
                ? 'Pick the events to merge into one.'
                : merged
                  ? `Merge ${picked.length} events into one.`
                  : 'These can’t be merged. Pick events at the same time on different days, or back to back on the same days.'}
            </p>
            <Button size="sm" disabled={!merged} onClick={mergeSelected}>
              Merge selected
            </Button>
          </div>
        ) : null}
        {events.length ? (
          <ul className="flex flex-col divide-y divide-border-subtle">
            {events.map((e) => (
              <li key={e.id} className="flex items-center gap-3 py-2.5">
                {selecting ? (
                  <Checkbox
                    aria-label={`Pick ${e.title} to merge`}
                    checked={selected.includes(e.id)}
                    onCheckedChange={(checked) =>
                      setSelected((prev) =>
                        checked === true ? [...prev, e.id] : prev.filter((x) => x !== e.id),
                      )
                    }
                  />
                ) : null}
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
                {splitKind(e) ? (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={
                      splitKind(e) === 'days'
                        ? `Split ${e.title} into one event per day`
                        : `Split ${e.title} into two`
                    }
                    title={splitKind(e) === 'days' ? 'Split by day' : 'Split in two'}
                    onClick={() => split(e)}
                  >
                    <Scissors aria-hidden="true" />
                  </Button>
                ) : null}
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
      </section>

      <section aria-labelledby="period-title" className="rounded-2xl border bg-card p-4 md:p-5">
        <h2 id="period-title" className="text-[15px] font-semibold">
          When does this schedule run?
        </h2>
        <p className="mb-3 text-xs text-muted-foreground">
          {manual
            ? 'Pick the dates it covers.'
            : job.periodFromFile
              ? 'We found these dates in the file. Check them.'
              : 'We didn’t find dates in the file, so these are a guess. Set the real ones.'}
        </p>
        {periodHasEnded(period, today) ? (
          // A schedule entirely in the past never shows: usually a file without a year.
          <div
            role="alert"
            className="mb-3 flex flex-col items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
          >
            <p>{endedMessage(period)}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setPeriod(defaultManualPeriod(today))}
            >
              Start it today instead
            </Button>
          </div>
        ) : null}
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
        <Exceptions
          exceptions={exceptions}
          onAdd={(range) => setOwnExceptions((prev) => [...prev, range])}
          onRemove={(range) => {
            if (range.holiday) setDismissed((prev) => [...prev, range.start]);
            else setOwnExceptions((prev) => prev.filter((x) => x !== range));
          }}
        />
      </section>

      {replaces ? (
        <p className="flex items-start gap-2 rounded-xl bg-primary-soft p-3 text-sm text-primary-ink">
          <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          Confirming replaces {whose} current schedule ({formatPeriod(replaces)}).
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}
      <div className="sticky bottom-[max(1rem,env(safe-area-inset-bottom))] z-20 flex flex-col gap-2 rounded-2xl border bg-card/95 p-3 backdrop-blur sm:flex-row sm:items-center sm:justify-between md:bottom-4">
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

/**
 * The uploaded file itself, for comparing (FR-IMP-10). `original.url` is a same-origin route
 * that redirects to a 60-second signed Storage URL (the bucket is private, NFR-SEC-6). PDFs
 * show in the browser's viewer; HEIC only where the browser can show it (Safari), with a link
 * otherwise.
 */
function OriginalFile({ original, name }: { original: ParseJob['original']; name: string }) {
  const [broken, setBroken] = useState(false);
  if (!original) {
    return (
      <p className="flex flex-1 items-center justify-center rounded-lg bg-muted p-4 text-center text-sm text-muted-foreground">
        The file has been deleted.
      </p>
    );
  }
  if (original.mimeType === 'application/pdf') {
    return (
      <iframe
        src={original.url}
        title={`Your file: ${name}`}
        className="min-h-0 w-full flex-1 rounded-lg border bg-muted"
      />
    );
  }
  if (broken) {
    return (
      <p className="flex flex-1 flex-col items-center justify-center gap-2 rounded-lg bg-muted p-4 text-center text-sm text-muted-foreground">
        This browser can&apos;t show this photo here.
        <a
          href={original.url}
          target="_blank"
          rel="noreferrer"
          className="font-semibold text-primary-ink underline-offset-2 hover:underline"
        >
          Open it in a new tab
        </a>
      </p>
    );
  }
  return (
    <div className="min-h-0 flex-1 overflow-auto rounded-lg border bg-muted">
      {/* A short-lived signed URL behind a redirect: nothing next/image could optimise or cache. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={original.url}
        alt={`Your file: ${name}`}
        className="h-auto w-full"
        onError={() => setBroken(true)}
      />
    </div>
  );
}

/**
 * Breaks, holidays and exam periods when the schedule doesn't apply (FR-IMP-8). Public holidays
 * are listed already; the user can remove any of them and add their own.
 */
function Exceptions({
  exceptions,
  onAdd,
  onRemove,
}: {
  exceptions: EditableException[];
  onAdd: (range: EditableException) => void;
  onRemove: (range: EditableException) => void;
}) {
  const [label, setLabel] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [error, setError] = useState<string>();

  function add() {
    const parsed = DateRange.safeParse({ start, end: end || start, label });
    if (!parsed.success) {
      setError(start ? 'The last day can’t be before the first.' : 'Pick the first day.');
      return;
    }
    const { label: name, ...range } = parsed.data;
    onAdd(name ? { ...range, label: name } : range);
    setLabel('');
    setStart('');
    setEnd('');
    setError(undefined);
  }

  return (
    <div className="mt-5 flex flex-col gap-3">
      <div>
        <h3 className="text-sm font-semibold">Breaks and holidays</h3>
        <p className="text-xs text-muted-foreground">
          You won&apos;t show as busy from this schedule on these days. We&apos;ve added Jamaican
          public holidays; remove any that don&apos;t apply.
        </p>
      </div>
      {exceptions.length ? (
        <ul className="flex flex-col divide-y divide-border-subtle rounded-xl border">
          {exceptions.map((x) => (
            <li
              key={`${x.start}-${x.end}-${x.label ?? ''}`}
              className="flex items-center gap-3 px-3 py-2"
            >
              <CalendarOff aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium">{x.label || 'Break'}</span>
                <span className="font-mono text-xs text-muted-foreground">
                  {formatDateRange(x)}
                </span>
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove ${x.label || 'break'} (${formatDateRange(x)})`}
                onClick={() => onRemove(x)}
              >
                <X aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No breaks in these dates.</p>
      )}
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
        <div className="flex flex-col gap-2">
          <Label htmlFor="exception-label">Name (optional)</Label>
          <Input
            id="exception-label"
            value={label}
            maxLength={SCHEDULE_EXCEPTION_LABEL_MAX_LENGTH}
            placeholder="Reading week"
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="exception-start">First day</Label>
          <Input
            id="exception-start"
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="exception-end">Last day</Label>
          <Input
            id="exception-end"
            type="date"
            value={end}
            min={start || undefined}
            onChange={(e) => setEnd(e.target.value)}
          />
        </div>
        <Button variant="soft" onClick={add}>
          <Plus aria-hidden="true" />
          Add break
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
