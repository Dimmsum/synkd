'use client';

import { Trash } from 'lucide-react';
import { ActionButton } from '@/components/app/action-buttons';
import { deletePendingUpload } from '@/lib/actions/imports';

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
