// The parse sweep (WF-027 NFR-REL-4, WF-037 files part, FR-ADM-4, D38), run by a cron through
// the internal sweep route:
//   1. re-dispatch parse jobs that are due: queued past their backoff (a dispatch that never
//      arrived, or a retry) or processing past their lease (a crashed or timed-out run);
//   2. delete unconfirmed files past their 7-day `delete_at`, with their jobs and drafts;
//   3. remove the Storage objects of deleted files that are still there, retrying failed
//      removals with backoff until they succeed.
// Returns counts only, which the route sends back so the cron's log records each run.

import type { ParseAdmin } from './admin';

export interface SweepResult {
  dispatched: number;
  expiredFiles: number;
  removedObjects: number;
  removalsLeft: number;
}

export const SWEEP_MAX_JOBS = 20;
export const SWEEP_MAX_FILES = 200;
export const SWEEP_MAX_REMOVALS = 100;

export async function sweep(deps: {
  admin: Pick<
    ParseAdmin,
    'listDue' | 'expireFiles' | 'claimRemovals' | 'remove' | 'finishRemovals'
  >;
  dispatch(jobId: string): Promise<void>;
}): Promise<SweepResult> {
  const due = await deps.admin.listDue(SWEEP_MAX_JOBS);
  await Promise.all(due.map((id) => deps.dispatch(id)));

  const expiredFiles = await deps.admin.expireFiles(SWEEP_MAX_FILES);

  const paths = await deps.admin.claimRemovals(SWEEP_MAX_REMOVALS);
  let removedObjects = 0;
  if (paths.length > 0 && (await deps.admin.remove(paths))) {
    removedObjects = await deps.admin.finishRemovals(paths);
  }
  return {
    dispatched: due.length,
    expiredFiles,
    removedObjects,
    removalsLeft: paths.length - removedObjects,
  };
}
