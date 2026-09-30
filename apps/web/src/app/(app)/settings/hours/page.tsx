import type { Metadata } from 'next';
import { Panel } from '@/components/app/page-header';
import { HoursEditor } from '@/components/settings/hours-editor';
import { SettingsPage } from '@/components/settings/settings-page';
import { getAvailableHours } from '@/lib/data/settings';

export const metadata: Metadata = { title: 'Available hours' };

export default async function HoursPage() {
  const hours = await getAvailableHours();
  return (
    <SettingsPage
      title="Available hours"
      subtitle="Friends only see you as free inside these hours, even when your schedule is empty. Outside them you show as Away."
    >
      <Panel>
        <HoursEditor initial={hours} />
      </Panel>
    </SettingsPage>
  );
}
