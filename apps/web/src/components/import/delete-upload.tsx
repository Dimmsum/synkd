'use client';

// Client pieces of Pending uploads (FR-IMP-14, FR-IMP-16, WF-032): delete now, try a failed
// parse again, and live updates while a parse runs.

import { RotateCcw, Trash } from 'lucide-react';
import { PARSE_JOB_CHANGED_EVENT } from '@whosfree/shared';
import { ActionButton } from '@/components/app/action-buttons';
import { useRefetch, useUserSignals } from '@/components/realtime/use-user-signals';
import { deletePendingUpload, startParse } from '@/lib/actions/imports';

export function DeleteUploadButton({ id, name }: { id: string; name: string }) {
  return (
    <ActionButton
      action={() => deletePendingUpload(id)}
      doneLabel="Deleted"
      icon={<Trash aria-hidden="true" />}
      ariaLabel={`Delete ${name} now`}
    >
      Delete now
    </ActionButton>
  );
}

/** Retries a failed parse of a pending file; uses one of the day's attempts (FR-IMP-19). */
export function RetryParseButton({ fileId, name }: { fileId: string; name: string }) {
  return (
    <ActionButton
      action={async () => {
        const res = await startParse(fileId);
        return res.ok ? { ok: true } : res;
      }}
      doneLabel="Reading it again"
      variant="default"
      icon={<RotateCcw aria-hidden="true" />}
      ariaLabel={`Try reading ${name} again`}
    >
      Try again
    </ActionButton>
  );
}

/** Re-renders the list when one of the viewer's uploads or parse jobs changes (FR-IMP-13). */
export function UploadsLive({ viewerId }: { viewerId: string }) {
  const refetch = useRefetch();
  useUserSignals(viewerId, PARSE_JOB_CHANGED_EVENT, refetch, 'Pending uploads');
  return null;
}
