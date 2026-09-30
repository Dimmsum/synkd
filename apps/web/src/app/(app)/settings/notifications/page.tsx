import type { Metadata } from 'next';
import { Panel } from '@/components/app/page-header';
import { NotificationsForm } from '@/components/settings/forms';
import { SettingsPage } from '@/components/settings/settings-page';
import { getNotificationSettings } from '@/lib/data/settings';

export const metadata: Metadata = { title: 'Notifications' };

// FR-SET-3 (per-type settings) and FR-PING-7 (quiet hours).
export default async function NotificationsPage() {
  const settings = await getNotificationSettings();
  return (
    <SettingsPage title="Notifications">
      <Panel>
        <NotificationsForm initial={settings} />
      </Panel>
    </SettingsPage>
  );
}
