'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
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
import {
  PARSE_JOB_CHANGED_EVENT,
  SCHEDULE_FILE_MIME_TYPES,
  SCHEDULE_FILES_BUCKET,
  type ParseErrorCode,
  type ParseJobStatus,
} from '@whosfree/shared';
import { Button, buttonVariants } from '@whosfree/ui/components/button';
import { cn } from '@whosfree/ui/lib/utils';
import { useUserSignals } from '@/components/realtime/use-user-signals';
import { getParseState, startParse, startUpload } from '@/lib/actions/imports';
import { canRetry, parseFailureMessage } from '@/lib/parse-messages';
import { createBrowserSupabase } from '@/lib/supabase/browser';
import type { OfflineFriendRef } from '@/lib/types';
import { checkFile, prepareForUpload, sha256Hex } from '@/lib/upload-file';

type Phase = 'idle' | 'preparing' | 'uploading' | 'queued' | 'processing' | 'ready' | 'failed';

const PHASES: { key: Phase; label: string }[] = [
  { key: 'uploading', label: 'Uploading' },
  { key: 'queued', label: 'Waiting in line' },
  { key: 'processing', label: 'Reading your schedule' },
  { key: 'ready', label: 'Ready to review' },
];

const PHASE_OF: Record<ParseJobStatus, Phase> = {
  queued: 'queued',
  processing: 'processing',
  needs_review: 'ready',
  committed: 'ready',
  failed: 'failed',
};

/** While a job is waiting or running, re-read it this often in case a live signal is missed. */
const POLL_MS = 5_000;

/** Follows a job on the viewer's private Realtime channel (FR-IMP-13, D41). */
function JobSignals({ viewerId, onChange }: { viewerId: string; onChange: () => void }) {
  useUserSignals(viewerId, PARSE_JOB_CHANGED_EVENT, onChange, 'Upload');
  return null;
}

/**
 * Upload a timetable or roster (WF-026) and follow the parse job live (WF-027, FR-IMP-13).
 * Photos are compressed on the device first (NFR-PERF-6) and go straight to private Storage.
 * On failure: try again, use a different file, or enter it by hand (FR-IMP-14). The file is
 * deleted once the schedule is confirmed, or after 7 days (D38). With `offlineFriend`, the
 * upload is that friend's timetable (WF-127) all the way to confirm.
 */
export function UploadCard({
  flow,
  offlineFriend = null,
}: {
  flow: 'import' | 'onboarding';
  offlineFriend?: OfflineFriendRef | null;
}) {
  const friendQuery = offlineFriend ? `?friend=${offlineFriend.id}` : '';
  const reviewHref = (jobId: string): Route =>
    flow === 'import'
      ? (`/import/${jobId}/review` as Route)
      : (`/onboarding/review?job=${jobId}` as Route);
  const manualHref: Route =
    flow === 'import'
      ? (`/import/manual/review${friendQuery}` as Route)
      : ('/onboarding/review?job=manual' as Route);
  const id = useId();
  const [file, setFile] = useState<File>();
  const [error, setError] = useState<string>();
  const [phase, setPhase] = useState<Phase>('idle');
  const [failure, setFailure] = useState<ParseErrorCode | null>(null);
  const [fileId, setFileId] = useState<string>();
  const [jobId, setJobId] = useState<string>();
  const [viewerId, setViewerId] = useState<string>();
  const [dragging, setDragging] = useState(false);
  const jobRef = useRef<string | undefined>(undefined);

  const refresh = useCallback(async () => {
    const current = jobRef.current;
    if (!current) return;
    const state = await getParseState(current);
    // A newer job may have started meanwhile.
    if (!state || jobRef.current !== current) return;
    setPhase(PHASE_OF[state.status]);
    setFailure(state.status === 'failed' ? state.error : null);
  }, []);

  const busy =
    phase === 'preparing' || phase === 'uploading' || phase === 'queued' || phase === 'processing';
  const waiting = phase === 'queued' || phase === 'processing';

  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [waiting, refresh]);

  function follow(job: string) {
    jobRef.current = job;
    setJobId(job);
  }

  function pick(f: File | undefined) {
    if (busy) return;
    setPhase('idle');
    setFile(undefined);
    setFailure(null);
    setFileId(undefined);
    jobRef.current = undefined;
    setJobId(undefined);
    if (!f) return;
    const problem = checkFile(f);
    setError(problem);
    if (!problem) setFile(f);
  }

  async function parse(uploadedFileId: string) {
    setPhase('queued');
    setFailure(null);
    const started = await startParse(uploadedFileId);
    if (!started.ok) {
      setError(started.error);
      setPhase(jobRef.current ? 'failed' : 'idle');
      return;
    }
    follow(started.data.jobId);
    await refresh();
  }

  async function upload() {
    if (!file) return;
    setError(undefined);
    setFailure(null);
    setPhase('preparing');
    try {
      const prepared = await prepareForUpload(file);
      if (!prepared) {
        setError('That file type won’t work. Use a PDF, PNG, JPG, HEIC or WebP.');
        setPhase('idle');
        return;
      }
      const sha256 = await sha256Hex(prepared.blob);
      const started = await startUpload({
        fileName: prepared.name,
        size: prepared.blob.size,
        type: prepared.type,
        sha256,
        offlineFriendId: offlineFriend?.id ?? null,
      });
      if (!started.ok) {
        setError(started.error);
        setPhase('idle');
        return;
      }
      const { data } = started;
      setViewerId(data.viewerId);
      setFileId(data.fileId);

      if (data.upload) {
        setPhase('uploading');
        const storage = createBrowserSupabase(() => Promise.resolve(null)).storage;
        const { error: uploadError } = await storage
          .from(SCHEDULE_FILES_BUCKET)
          .uploadToSignedUrl(
            data.upload.path,
            data.upload.token,
            await prepared.blob.arrayBuffer(),
            {
              contentType: prepared.type,
              upsert: true,
            },
          );
        if (uploadError) {
          // The status only: the error can carry the signed URL (NFR-SEC-11).
          console.warn('Upload failed', 'status' in uploadError ? uploadError.status : 'error');
          setError('The upload didn’t go through. Check your connection and try again.');
          setPhase('idle');
          return;
        }
      }

      if (data.jobId && !data.upload) {
        // An identical file is already waiting (WF-035): follow its job, no new attempt.
        follow(data.jobId);
        await refresh();
        return;
      }
      await parse(data.fileId);
    } catch {
      setError('Something went wrong on our side. Try again.');
      setPhase('idle');
    }
  }

  const activeIndex = PHASES.findIndex((p) => p.key === phase);
  const whose = offlineFriend ? `${offlineFriend.nickname}’s` : 'your';

  return (
    <div className="flex flex-col gap-4">
      {viewerId && jobId ? (
        <JobSignals viewerId={viewerId} onChange={() => void refresh()} />
      ) : null}
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
        <span className="font-semibold">Choose {whose} timetable or roster</span>
        <span className="text-sm text-muted-foreground">
          PDF, photo or screenshot · up to 10 MB · PDFs up to 5 pages
        </span>
        <input
          id={`${id}-file`}
          type="file"
          accept={`${SCHEDULE_FILE_MIME_TYPES.join(',')},.heic,.heif`}
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
        <div role="alert" className="flex flex-col gap-2 rounded-xl bg-destructive/10 p-3">
          <p className="flex items-start gap-2 text-sm font-medium text-destructive">
            <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" /> {error}
          </p>
        </div>
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
            {phase === 'preparing' ? (
              <span className="flex items-center gap-2 text-sm text-muted-foreground">
                <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> Getting it ready
              </span>
            ) : null}
          </div>

          {phase !== 'idle' && phase !== 'preparing' && phase !== 'failed' ? (
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
          {waiting ? (
            <p className="text-xs text-muted-foreground">
              This usually takes under a minute. You can leave and come back: it waits for you in{' '}
              <Link
                href="/uploads"
                className="font-semibold text-primary-ink underline-offset-2 hover:underline"
              >
                Pending uploads
              </Link>
              .
            </p>
          ) : null}

          {phase === 'ready' && jobId ? (
            <Link
              href={reviewHref(jobId)}
              className={buttonVariants({ className: 'w-full sm:w-fit' })}
            >
              Review {whose} schedule
            </Link>
          ) : null}

          {phase === 'failed' ? (
            // FR-IMP-14: retry, try a different file, or enter it by hand.
            <div role="alert" className="flex flex-col gap-3 rounded-xl bg-status-dnd-soft p-3">
              <p className="text-sm font-semibold text-status-dnd-ink">
                {parseFailureMessage(failure)}
              </p>
              <div className="flex flex-wrap gap-2">
                {fileId && canRetry(failure) ? (
                  <Button size="sm" onClick={() => void parse(fileId)}>
                    Try again
                  </Button>
                ) : null}
                <label
                  htmlFor={`${id}-file`}
                  className={cn(
                    buttonVariants({
                      variant: fileId && canRetry(failure) ? 'outline' : 'default',
                      size: 'sm',
                    }),
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
