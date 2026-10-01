// Schedule import reads (WF-026, WF-029, WF-031, WF-032, WF-127): parse jobs and their drafts,
// pending uploads, and the offline friend an import is for. Everything is read as the viewer
// under RLS (owner-only), so another user's job, file or friend simply isn't found (D41).

import 'server-only';
import { DEFAULT_TIMEZONE, ParseDraft, PARSE_ERROR_CODES } from '@whosfree/shared';
import type { ParseErrorCode, ParseJobStatus } from '@whosfree/shared';
import { dateKey } from '@whosfree/ui/lib/time';
import type { OfflineFriendRef, ParseJob, PendingUpload } from '@/lib/types';
import { defaultManualPeriod, MANUAL_JOB_ID } from '@/lib/schedule-draft';
import { isUuid } from '@/lib/social/mappers';
import { createServerSupabase } from '@/lib/supabase/server';

/** Where the original of a pending upload is viewed: redirects to a short-lived signed URL. */
export const originalFileHref = (fileId: string) => `/uploads/${fileId}/original`;

const asErrorCode = (error: string | null): ParseErrorCode | null =>
  error && (PARSE_ERROR_CODES as readonly string[]).includes(error)
    ? (error as ParseErrorCode)
    : error
      ? 'parse_failed'
      : null;

/** One of the viewer's offline friends by id (WF-127), or null if it isn't theirs. */
export async function getOfflineFriendRef(
  id: string | undefined,
): Promise<OfflineFriendRef | null> {
  if (!id || !isUuid(id)) return null;
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from('offline_friends')
    .select('id, nickname')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`Reading an offline friend failed (${error.code})`);
  return data;
}

/**
 * A parse job and its draft (FR-IMP-9), read under RLS, with a link to the original file
 * (FR-IMP-10). `manual` starts an empty draft for manual entry (FR-IMP-12, WF-031), running
 * 16 weeks from today until the user picks the dates. Null when there's no such job of the
 * viewer's. A job that isn't ready for review comes back with no events and its status.
 */
export async function getParseJob(id: string): Promise<ParseJob | null> {
  const today = dateKey(new Date(), DEFAULT_TIMEZONE);
  if (id === MANUAL_JOB_ID) {
    return {
      id,
      fileName: '',
      status: 'needs_review',
      events: [],
      period: defaultManualPeriod(today),
    };
  }
  if (!isUuid(id)) return null;

  const supabase = await createServerSupabase();
  const { data: job, error } = await supabase
    .from('parse_jobs')
    .select(
      'id, status, draft, error, file:schedule_files (id, file_name, mime_type, pages, offline_friend_id)',
    )
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`Reading a parse job failed (${error.code})`);
  if (!job) return null;

  const file = job.file;
  const offlineFriend = file?.offline_friend_id
    ? await getOfflineFriendRef(file.offline_friend_id)
    : null;
  // Validated again on the way out; a draft that doesn't fit shows as empty, never raw.
  const draft = ParseDraft.safeParse(job.draft);
  const suggested = draft.success ? draft.data.suggestedPeriod : undefined;
  return {
    id: job.id,
    fileName: file?.file_name ?? 'Schedule',
    status: job.status as ParseJobStatus,
    error: asErrorCode(job.error),
    events: draft.success ? draft.data.events.map((e, i) => ({ ...e, id: `e${i + 1}` })) : [],
    period: suggested
      ? { start: suggested.start, end: suggested.end, exceptions: suggested.exceptions }
      : defaultManualPeriod(today),
    periodFromFile: Boolean(suggested),
    ...(file
      ? {
          original: {
            url: originalFileHref(file.id),
            mimeType: file.mime_type,
            pages: file.pages,
          },
        }
      : {}),
    offlineFriend,
  };
}

/**
 * Files that haven't been confirmed yet, newest first, each with its deletion date and its
 * parse job's state (FR-IMP-16, D38, WF-032).
 */
export async function getPendingUploads(): Promise<PendingUpload[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from('schedule_files')
    .select(
      'id, file_name, uploaded_at, delete_at, offline_friend_id, job:parse_jobs (id, status, error)',
    )
    .order('uploaded_at', { ascending: false });
  if (error) throw new Error(`Reading pending uploads failed (${error.code})`);

  const friendIds = [
    ...new Set(data.map((f) => f.offline_friend_id).filter((x): x is string => Boolean(x))),
  ];
  const friends = new Map<string, OfflineFriendRef>();
  if (friendIds.length > 0) {
    const { data: rows, error: friendError } = await supabase
      .from('offline_friends')
      .select('id, nickname')
      .in('id', friendIds);
    if (friendError) throw new Error(`Reading offline friends failed (${friendError.code})`);
    for (const r of rows) friends.set(r.id, r);
  }

  return data.map((f) => {
    // One job per file (unique file_id); PostgREST returns it as an object or a list.
    const job = Array.isArray(f.job) ? f.job[0] : f.job;
    return {
      id: f.id,
      fileName: f.file_name,
      uploadedAt: f.uploaded_at,
      deleteAt: f.delete_at,
      jobId: job?.id ?? null,
      jobStatus: (job?.status as ParseJobStatus | undefined) ?? null,
      error: asErrorCode(job?.error ?? null),
      offlineFriend: f.offline_friend_id ? (friends.get(f.offline_friend_id) ?? null) : null,
    };
  });
}

/** The state of one of the viewer's parse jobs (the upload card follows it, FR-IMP-13). */
export async function getParseJobState(
  id: string,
): Promise<{ status: ParseJobStatus; error: ParseErrorCode | null } | null> {
  if (!isUuid(id)) return null;
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from('parse_jobs')
    .select('status, error')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`Reading a parse job failed (${error.code})`);
  return data ? { status: data.status as ParseJobStatus, error: asErrorCode(data.error) } : null;
}
