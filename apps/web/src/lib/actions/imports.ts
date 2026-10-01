'use server';

// Schedule import (WF-026 upload, WF-029 review, WF-030 commit, WF-031 manual entry, WF-032
// pending uploads).

import { revalidatePath } from 'next/cache';
import { scheduleErrorMessage } from '@/lib/db-errors';
import { checkSchedule, MANUAL_JOB_ID } from '@/lib/schedule-draft';
import { isUuid } from '@/lib/social/mappers';
import { createServerSupabase } from '@/lib/supabase/server';
import { fail, mockDelay, ok, type ActionResult } from './result';

export async function startUpload(input: {
  fileName: string;
  size: number;
  type: string;
}): Promise<ActionResult & { jobId?: string }> {
  // TODO(WF-026): get a signed upload URL, upload to private Storage, create the
  // scheduleFiles row (deleteAt = +7 days) and a queued parse job (WF-027). The server
  // re-checks type by magic bytes and size (NFR-SEC-6).
  void input;
  await mockDelay(600);
  return { ok: true, jobId: 'job-1' };
}

/**
 * Confirm a reviewed or typed-in schedule (FR-IMP-9, FR-IMP-12): `commit_schedule` saves it as
 * the viewer's schedule, or as one of their offline friends' when `offlineFriendId` is set
 * (WF-127, D44), replacing the previous uploaded or typed-in one (FR-IMP-17). Exceptions
 * (breaks, the pre-filled holidays) go in `period.exceptions` (FR-IMP-8).
 */
export async function confirmSchedule(input: {
  /** The parse job being confirmed, or `manual` for manual entry (WF-031). */
  jobId: string;
  events: unknown[];
  period: unknown;
  /** Save it as this offline friend's schedule instead of the viewer's (WF-127). */
  offlineFriendId?: string | null;
}): Promise<ActionResult> {
  const checked = checkSchedule(input);
  if (!checked.ok) return fail(checked.error);
  const offlineFriendId = input.offlineFriendId ?? null;
  if (offlineFriendId !== null && !isUuid(offlineFriendId)) {
    return fail('We couldn’t find that friend. They may have been removed.');
  }

  if (input.jobId !== MANUAL_JOB_ID) {
    // TODO(WF-027/WF-030): confirm the parse job instead: commit_schedule with
    // source_type 'upload' and the job id, which moves the job to `committed` and deletes the
    // draft and the file's row in the same transaction (D38); then remove the Storage object
    // straight away (the expiry cron retries a failed removal). Until uploads are real the
    // review screen runs on a mock job, so nothing is saved here.
    await mockDelay();
    return ok;
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc('commit_schedule', {
    draft: checked.draft,
    source_type: 'manual',
    ...(offlineFriendId ? { offline_friend_id: offlineFriendId } : {}),
  });
  if (error) {
    // The code only: never titles or dates (NFR-SEC-11).
    console.error('commit_schedule failed', error.code);
    return fail(scheduleErrorMessage(error.code, error.details, checked.draft));
  }

  // A new schedule changes the viewer's status everywhere (the chip in the app shell, Now) as
  // well as My schedule and Settings.
  revalidatePath('/', 'layout');
  return ok;
}

export async function deletePendingUpload(_uploadId: string): Promise<ActionResult> {
  // TODO(WF-032): delete the file and its draft now.
  await mockDelay();
  return ok;
}
