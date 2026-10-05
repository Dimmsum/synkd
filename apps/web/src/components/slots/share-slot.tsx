'use client';

import { useState } from 'react';
import { Copy, Send } from 'lucide-react';
import { Button } from '@synkd/ui/components/button';
import { ActionButton } from '@/components/app/action-buttons';
import { sendPing } from '@/lib/actions/pings';

/**
 * Share a chosen slot (FR-SLOT-5, WF-099): copy it as text for WhatsApp, or send it as a
 * group ping when the viewer has the `groupPing` permission.
 */
export function ShareSlot({
  text,
  groupId,
  canGroupPing,
}: {
  text: string;
  groupId?: string;
  canGroupPing: boolean;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={async () => {
          await navigator.clipboard.writeText(text);
          setCopied(true);
        }}
        aria-label={`Copy "${text}" for WhatsApp`}
      >
        <Copy aria-hidden="true" />
        {copied ? 'Copied' : 'Copy for WhatsApp'}
      </Button>
      {groupId && canGroupPing ? (
        <ActionButton
          action={() => sendPing({ to: { groupId }, template: 'Link up?', text })}
          doneLabel="Sent to the group"
          variant="soft"
          icon={<Send aria-hidden="true" />}
        >
          Ping the group
        </ActionButton>
      ) : null}
    </div>
  );
}
