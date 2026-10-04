import type { Metadata } from 'next';
import { BellOff } from 'lucide-react';
import { ComingSoon } from '@/components/app/coming-soon';
import { Panel } from '@/components/app/page-header';
import { PushPermission } from '@/components/push/push-permission';
import { SettingsPage } from '@/components/settings/settings-page';

export const metadata: Metadata = { title: 'Notifications' };

// Push on this device (WF-091): explanation first, then the permission prompt (FR-PWA-4).
// Per-type settings (FR-SET-3) and quiet hours (FR-PING-7) say they're coming until they're
// saved (WF-134).
// TODO(FR-SET-3, WF-094): NotificationsForm (components/settings/forms.tsx) with the saved
// preferences, once saveNotificationSettings stores them.
export default function NotificationsPage() {
  return (
    <SettingsPage title="Notifications">
      <Panel>
        <div className="flex flex-col gap-5">
          <PushPermission />
          <ComingSoon icon={BellOff} title="Choosing what you’re notified about is coming soon">
            So are quiet hours.
          </ComingSoon>
        </div>
      </Panel>
    </SettingsPage>
  );
}
