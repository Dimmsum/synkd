'use server';

// Schedule import (WF-026 upload, WF-029 review, WF-030 commit, WF-032 pending uploads).

import { EventDraft, SchedulePeriod } from '@whosfree/shared';
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

export async function confirmSchedule(input: {
  jobId: string;
  events: unknown[];
  period: unknown;
}): Promise<ActionResult> {
  if (!input.events.length) return fail('Add at least one event, or skip for now.');
  for (const e of input.events) {
    if (!EventDraft.safeParse(e).success) return fail('One of the events needs fixing.');
  }
  if (!SchedulePeriod.safeParse(input.period).success) {
    return fail('Check the start and end dates of your schedule.');
  }
  // TODO(WF-030): commit_schedule writes events (RRULE) and deletes the draft and the
  // file in the same transaction (D38); then remove the Storage object.
  await mockDelay();
  return ok;
}

export async function deletePendingUpload(_uploadId: string): Promise<ActionResult> {
  // TODO(WF-032): delete the file and its draft now.
  await mockDelay();
  return ok;
}
