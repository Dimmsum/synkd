'use server';

// Schedule import (WF-026 upload, WF-027 parse, WF-029 review, WF-030 commit, WF-031 manual
// entry, WF-032 pending uploads, WF-035 limits, WF-127 offline friends). Every check about
// whose file, job or friend it is, and every limit, happens in the database functions called
// with the user's own token; the secret key (lib/parse/admin.ts) only signs URLs for and
// removes the Storage paths those functions return (D41).
//
// Files never pass through here (the 4.5 MB body limit on serverless hosts, spike §6): the
// browser uploads straight to Storage with a signed upload URL for a path the database chose.
// Logs carry error codes only (NFR-SEC-11).

import { after } from 'next/server';
import { revalidatePath } from 'next/cache';
import {
  DEFAULT_TIMEZONE,
  SCHEDULE_FILE_MAX_BYTES,
  SCHEDULE_FILE_MIME_TYPES,
  type ParseErrorCode,
  type ParseJobStatus,
} from '@whosfree/shared';
import type { Json } from '@whosfree/backend';
import { dateKey } from '@whosfree/ui/lib/time';
import { getParseJobState } from '@/lib/data/imports';
import { scheduleErrorMessage, TRY_AGAIN, uploadErrorMessage } from '@/lib/db-errors';
import { removeNow, requireParseAdmin } from '@/lib/parse/admin';
import { dispatchParseJob, isStalledJob } from '@/lib/parse/runner';
import { checkSchedule, MANUAL_JOB_ID } from '@/lib/schedule-draft';
import { isUuid } from '@/lib/social/mappers';
import { createServerSupabase } from '@/lib/supabase/server';
import { fail, ok, type ActionResult } from './result';

export interface StartedUpload {
  fileId: string;
  /** The file's parse job when an identical pending upload was reused (WF-035). */
  jobId: string | null;
  /** Where to upload, or null when nothing needs uploading. */
  upload: { path: string; token: string } | null;
  /** The viewer's users.id, for following the job on their Realtime channel. */
  viewerId: string;
}

/**
 * Registers an upload (WF-026): the database picks the Storage path (or reuses an identical
 * pending file, WF-035) and the server signs an upload URL for that path only. The browser
 * then uploads to Storage directly and calls {@link startParse}.
 */
export async function startUpload(input: {
  fileName: string;
  size: number;
  type: string;
  /** Lowercase hex SHA-256 of the bytes being uploaded. */
  sha256: string;
  /** Upload an offline friend's timetable instead of the viewer's (WF-127). */
  offlineFriendId?: string | null;
}): Promise<ActionResult<StartedUpload>> {
  const friend = input.offlineFriendId ?? null;
  if (
    !(SCHEDULE_FILE_MIME_TYPES as readonly string[]).includes(input.type) ||
    !Number.isInteger(input.size) ||
    input.size < 1 ||
    input.size > SCHEDULE_FILE_MAX_BYTES ||
    !/^[0-9a-f]{64}$/.test(input.sha256) ||
    (friend !== null && !isUuid(friend))
  ) {
    return fail('That file won’t work. Use a PDF, PNG, JPG, HEIC or WebP up to 10 MB.');
  }

  const supabase = await createServerSupabase();
  const [{ data, error }, viewer] = await Promise.all([
    supabase.rpc('create_schedule_upload', {
      file_name: input.fileName.slice(0, 500),
      mime_type: input.type,
      size_bytes: input.size,
      sha256: input.sha256,
      ...(friend ? { offline_friend_id: friend } : {}),
    }),
    supabase.rpc('current_user_id'),
  ]);
  if (error) {
    console.error('create_schedule_upload failed', error.code);
    return fail(uploadErrorMessage(error.code, error.details));
  }
  const row = data[0];
  if (!row || viewer.error || !viewer.data) return fail(TRY_AGAIN);

  let upload: StartedUpload['upload'] = null;
  if (row.needs_upload) {
    try {
      upload = await requireParseAdmin().signUpload(row.storage_path);
    } catch (err) {
      console.error('Signing an upload failed', (err as Error).message);
      return fail(TRY_AGAIN);
    }
  }
  return {
    ok: true,
    data: { fileId: row.file_id, jobId: row.job_id, upload, viewerId: viewer.data },
  };
}

/**
 * Queues the parse of an uploaded file (WF-027) and dispatches it after the response. Also
 * "Try again" for a failed parse (FR-IMP-14). 5 a day (FR-IMP-19, WF-035): the message says so
 * when they're used up.
 */
export async function startParse(fileId: string): Promise<ActionResult<{ jobId: string }>> {
  if (!isUuid(fileId)) return fail(uploadErrorMessage('P0002', undefined));
  const supabase = await createServerSupabase();
  const { data: jobId, error } = await supabase.rpc('start_parse_job', { file_id: fileId });
  if (error) {
    console.error('start_parse_job failed', error.code);
    return fail(uploadErrorMessage(error.code, error.details));
  }
  after(() => dispatchParseJob(jobId));
  revalidatePath('/uploads');
  return { ok: true, data: { jobId } };
}

/**
 * Where one of the viewer's parse jobs is (the upload card follows it, FR-IMP-13). A job that
 * has sat queued, or outlived its run's lease, is dispatched again (WF-131): the read is the
 * viewer's own under RLS, and the claim runs it at most once.
 */
export async function getParseState(
  jobId: string,
): Promise<{ status: ParseJobStatus; error: ParseErrorCode | null } | null> {
  const state = await getParseJobState(jobId);
  if (!state) return null;
  if (isStalledJob(state, new Date())) after(() => dispatchParseJob(jobId));
  return { status: state.status, error: state.error };
}

/**
 * Confirm a reviewed or typed-in schedule (FR-IMP-9, FR-IMP-12). For a parse job,
 * `confirm_parse_job` commits it for whoever the upload was for (the viewer or an offline
 * friend, WF-127), marks the job committed and deletes the draft and the file's row in the
 * same transaction (WF-030, D38); the Storage object is removed straight after (the sweep
 * retries if that fails). Manual entry calls `commit_schedule` directly, for the viewer or
 * `offlineFriendId`. Either replaces the previous uploaded or typed-in schedule (FR-IMP-17).
 * Exceptions (breaks, the pre-filled holidays) go in `period.exceptions` (FR-IMP-8).
 */
export async function confirmSchedule(input: {
  /** The parse job being confirmed, or `manual` for manual entry (WF-031). */
  jobId: string;
  events: unknown[];
  period: unknown;
  /** Manual entry only: save it as this offline friend's schedule (WF-127). */
  offlineFriendId?: string | null;
}): Promise<ActionResult> {
  const checked = checkSchedule(input, dateKey(new Date(), DEFAULT_TIMEZONE));
  if (!checked.ok) return fail(checked.error);
  const offlineFriendId = input.offlineFriendId ?? null;
  if (offlineFriendId !== null && !isUuid(offlineFriendId)) {
    return fail('We couldn’t find that friend. They may have been removed.');
  }
  if (input.jobId !== MANUAL_JOB_ID && !isUuid(input.jobId)) {
    return fail('We couldn’t find that schedule. It may have been deleted.');
  }

  const supabase = await createServerSupabase();
  if (input.jobId === MANUAL_JOB_ID) {
    const { error } = await supabase.rpc('commit_schedule', {
      draft: checked.draft as unknown as Json,
      source_type: 'manual',
      ...(offlineFriendId ? { offline_friend_id: offlineFriendId } : {}),
    });
    if (error) {
      // The code only: never titles or dates (NFR-SEC-11).
      console.error('commit_schedule failed', error.code);
      return fail(scheduleErrorMessage(error.code, error.details, checked.draft));
    }
  } else {
    const { data, error } = await supabase.rpc('confirm_parse_job', {
      job_id: input.jobId,
      draft: checked.draft as unknown as Json,
    });
    if (error) {
      console.error('confirm_parse_job failed', error.code);
      if (error.code === 'P0002') {
        return fail('We couldn’t find that schedule. It may have been deleted.');
      }
      return fail(scheduleErrorMessage(error.code, error.details, checked.draft));
    }
    const path = data[0]?.storage_path;
    if (path) after(() => removeNow([path]));
  }

  // A new schedule changes the viewer's status everywhere (the chip in the app shell, Now) as
  // well as My schedule, Settings and Pending uploads.
  revalidatePath('/', 'layout');
  return ok;
}

/** Deletes a pending upload now, with its draft (FR-IMP-16, WF-032). */
export async function deletePendingUpload(fileId: string): Promise<ActionResult> {
  if (!isUuid(fileId)) return fail(uploadErrorMessage('P0002', undefined));
  const supabase = await createServerSupabase();
  const { data: path, error } = await supabase.rpc('delete_schedule_upload', { file_id: fileId });
  if (error) {
    console.error('delete_schedule_upload failed', error.code);
    return fail(uploadErrorMessage(error.code, error.details));
  }
  after(() => removeNow([path]));
  revalidatePath('/uploads');
  return ok;
}
