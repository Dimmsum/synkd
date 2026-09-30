import { PageHeader } from '@/components/app/page-header';
import { SettingsNav } from './settings-nav';

/** Shell for a settings section: side nav on desktop, back link on phones. */
export function SettingsPage({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
      <div className="hidden pt-1 lg:block">
        <SettingsNav variant="side" />
      </div>
      <div className="flex min-w-0 max-w-2xl flex-col">
        <PageHeader
          title={title}
          subtitle={subtitle}
          back={{ href: '/settings', label: 'Settings' }}
        />
        <div className="flex flex-col gap-4">{children}</div>
      </div>
    </div>
  );
}
