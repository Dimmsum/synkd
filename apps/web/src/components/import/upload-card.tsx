'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import {
  Camera,
  CircleCheck,
  FileText,
  LoaderCircle,
  PenLine,
  TriangleAlert,
  Upload,
} from 'lucide-react';
import { Button, buttonVariants } from '@whosfree/ui/components/button';
import { cn } from '@whosfree/ui/lib/utils';
import { startUpload } from '@/lib/actions/imports';

/** FR-IMP-1: PDF, PNG, JPG/JPEG, HEIC or WebP, up to 10 MB (PDFs up to 5 pages). */
export const ACCEPTED_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/heic',
  'image/webp',
];
const ACCEPTED_EXT = /\.(pdf|png|jpe?g|heic|webp)$/i;
export const MAX_BYTES = 10 * 1024 * 1024;

/** Client-side check only; the server re-checks by magic bytes (NFR-SEC-6). */
export function checkFile(file: { name: string; size: number; type: string }): string | undefined {
  if (!ACCEPTED_TYPES.includes(file.type) && !ACCEPTED_EXT.test(file.name)) {
    return 'That file type won’t work. Use a PDF, PNG, JPG, HEIC or WebP.';
  }
  if (file.size > MAX_BYTES) return 'That file is over 10 MB. Try a smaller photo or a PDF.';
  return undefined;
}

type Phase = 'idle' | 'uploading' | 'queued' | 'processing' | 'ready' | 'failed';

const PHASES: { key: Phase; label: string }[] = [
  { key: 'uploading', label: 'Uploading' },
  { key: 'queued', label: 'Waiting in line' },
  { key: 'processing', label: 'Reading your schedule' },
  { key: 'ready', label: 'Ready to review' },
];

/**
 * Upload a timetable or roster (WF-026) and follow the parse job (FR-IMP-13). The file is
 * deleted once you confirm the schedule, or after 7 days (D38).
 */
export function UploadCard({ flow }: { flow: 'import' | 'onboarding' }) {
  const reviewHref = (jobId: string): Route =>
    flow === 'import'
      ? (`/import/${jobId}/review` as Route)
      : (`/onboarding/review?job=${jobId}` as Route);
  const manualHref = reviewHref('manual');
  const id = useId();
  const [file, setFile] = useState<File>();
  const [error, setError] = useState<string>();
  const [phase, setPhase] = useState<Phase>('idle');
  const [jobId, setJobId] = useState<string>();
  const [dragging, setDragging] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  function pick(f: File | undefined) {
    setPhase('idle');
    setFile(undefined);
    if (!f) return;
    const problem = checkFile(f);
    setError(problem);
    if (!problem) setFile(f);
    // TODO(WF-026): compress images on the device to ≤ 2000 px before upload (NFR-PERF-6).
  }

  async function upload() {
    if (!file) return;
    setPhase('uploading');
    const res = await startUpload({ fileName: file.name, size: file.size, type: file.type });
    if (!res.ok || !res.jobId) {
      setPhase('failed');
      return;
    }
    setJobId(res.jobId);
    // TODO(WF-027): follow the real job via Realtime instead of these mock timers.
    const failing = /fail/i.test(file.name);
    timers.current = [
      setTimeout(() => setPhase('queued'), 400),
      setTimeout(() => setPhase('processing'), 1200),
      setTimeout(() => setPhase(failing ? 'failed' : 'ready'), 2600),
    ];
  }

  const busy = phase === 'uploading' || phase === 'queued' || phase === 'processing';
  const activeIndex = PHASES.findIndex((p) => p.key === phase);

  return (
    <div className="flex flex-col gap-4">
      <label
        htmlFor={`${id}-file`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          pick(e.dataTransfer.files[0]);
        }}
        className={cn(
          'flex cursor-pointer flex-col items-center gap-3 rounded-2xl border-2 border-dashed bg-card px-6 py-10 text-center transition-colors',
          'has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50',
          dragging ? 'border-primary bg-primary-soft' : 'hover:border-primary/50',
        )}
      >
        <span className="flex size-12 items-center justify-center rounded-full bg-primary-soft text-primary-ink">
          <Upload aria-hidden="true" className="size-6" />
        </span>
        <span className="font-semibold">Choose your timetable or roster</span>
        <span className="text-sm text-muted-foreground">
          PDF, photo or screenshot · up to 10 MB · PDFs up to 5 pages
        </span>
        <input
          id={`${id}-file`}
          type="file"
          accept={`${ACCEPTED_TYPES.join(',')},.heic`}
          className="sr-only"
          disabled={busy}
          onChange={(e) => pick(e.target.files?.[0])}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        {/* FR-IMP-2: the camera opens straight away on phones. */}
        <label
          htmlFor={`${id}-camera`}
          className={cn(
            buttonVariants({ variant: 'outline', size: 'sm' }),
            'cursor-pointer has-[:focus-visible]:ring-[3px]',
          )}
        >
          <Camera aria-hidden="true" />
          Take a photo
          <input
            id={`${id}-camera`}
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            disabled={busy}
            onChange={(e) => pick(e.target.files?.[0])}
          />
        </label>
        <Link href={manualHref} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
          <PenLine aria-hidden="true" />
          Enter it by hand instead
        </Link>
      </div>

      {error ? (
        <p role="alert" className="flex items-center gap-2 text-sm font-medium text-destructive">
          <TriangleAlert aria-hidden="true" className="size-4" /> {error}
        </p>
      ) : null}

      {file ? (
        <div className="flex flex-col gap-4 rounded-2xl border bg-card p-4">
          <div className="flex items-center gap-3">
            <FileText aria-hidden="true" className="size-5 text-primary-ink" />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-semibold">{file.name}</span>
              <span className="text-xs text-muted-foreground">
                {(file.size / 1024 / 1024).toFixed(1)} MB
              </span>
            </span>
            {phase === 'idle' ? <Button onClick={upload}>Upload</Button> : null}
          </div>

          {phase !== 'idle' && phase !== 'failed' ? (
            <ol aria-label="Progress" className="flex flex-col gap-2" aria-live="polite">
              {PHASES.map((p, i) => {
                const done = i < activeIndex || phase === 'ready';
                const current = i === activeIndex && phase !== 'ready';
                return (
                  <li
                    key={p.key}
                    className={cn(
                      'flex items-center gap-2 text-sm',
                      done
                        ? 'text-status-free-ink'
                        : current
                          ? 'font-semibold'
                          : 'text-muted-foreground',
                    )}
                  >
                    {done ? (
                      <CircleCheck aria-hidden="true" className="size-4" />
                    ) : current ? (
                      <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                    ) : (
                      <span aria-hidden="true" className="size-4 rounded-full border" />
                    )}
                    {p.label}
                    {done ? <span className="sr-only"> (done)</span> : null}
                  </li>
                );
              })}
            </ol>
          ) : null}
          {busy ? (
            <p className="text-xs text-muted-foreground">
              This usually takes under a minute. You can leave and come back.
            </p>
          ) : null}

          {phase === 'ready' && jobId ? (
            <Link
              href={reviewHref(jobId)}
              className={buttonVariants({ className: 'w-full sm:w-fit' })}
            >
              Review your schedule
            </Link>
          ) : null}

          {phase === 'failed' ? (
            // FR-IMP-14: retry, try a different file, or enter it by hand.
            <div role="alert" className="flex flex-col gap-3 rounded-xl bg-status-dnd-soft p-3">
              <p className="text-sm font-semibold text-status-dnd-ink">
                We couldn&apos;t read a schedule in that file.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={upload}>
                  Try again
                </Button>
                <label
                  htmlFor={`${id}-file`}
                  className={cn(
                    buttonVariants({ variant: 'outline', size: 'sm' }),
                    'cursor-pointer',
                  )}
                >
                  Use a different file
                </label>
                <Link
                  href={manualHref}
                  className={buttonVariants({ variant: 'ghost', size: 'sm' })}
                >
                  Enter it by hand
                </Link>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
