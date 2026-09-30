import type { Metadata } from 'next';
import Link from 'next/link';
import { CalendarDays, FileText, PenLine, TriangleAlert, Upload } from 'lucide-react';
import type { SourceType } from '@whosfree/shared';
import { buttonVariants } from '@whosfree/ui/components/button';
import { Panel } from '@/components/app/page-header';
import { SettingsPage } from '@/components/settings/settings-page';
import { getSources } from '@/lib/data/schedule';

export const metadata: Metadata = { title: 'Schedules and calendars' };

const ICONS: Record<SourceType, typeof FileText> = {
  upload: FileText,
  manual: PenLine,
  gcal: CalendarDays,
};

// Sources and sync health (FR-GCAL-10). The design also offered Apple Calendar and
// Outlook; the PRD's MVP has Google Calendar only (NG6), so they're left out.
export default async function CalendarsPage() {
  const sources = await getSources();
  return (
    <SettingsPage
      title="Schedules and calendars"
      subtitle="Where your busy times come from. We combine all of them."
    >
      <Panel>
        <ul className="flex flex-col divide-y divide-border-subtle">
          {sources.map((s) => {
            const Icon = ICONS[s.type];
            return (
              <li key={s.type} className="flex flex-wrap items-center gap-3 py-3">
                <span className="flex size-10 items-center justify-center rounded-xl bg-primary-soft text-primary-ink">
                  <Icon aria-hidden="true" className="size-5" />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-sm font-semibold">{s.label}</span>
                  <span className="text-xs text-muted-foreground">{s.detail}</span>
                </span>
                {s.status === 'healthy' ? (
                  <span className="rounded-full bg-status-free-soft px-2.5 py-1 text-xs font-semibold text-status-free-ink">
                    Connected
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-xs font-semibold text-status-soon-ink">
                    <TriangleAlert aria-hidden="true" className="size-3.5" /> Needs attention
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </Panel>
      <Panel id="upload" title="Timetable or roster">
        <p className="text-sm text-body-foreground">
          Your uploaded schedule ends <strong>Dec 12</strong>. Upload the new one any time; your old
          one stops on the date you pick.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link href="/import" className={buttonVariants({ size: 'sm' })}>
            <Upload aria-hidden="true" />
            Upload a new schedule
          </Link>
          <Link href="/uploads" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
            Pending uploads
          </Link>
        </div>
      </Panel>
      <Panel id="gcal" title="Google Calendar">
        <p className="text-sm text-body-foreground">
          We read your calendar only to know when you&apos;re busy. We keep start and end times, and
          titles only if you share Details with someone. Your Google data never goes to AI tools.
        </p>
        {/* TODO(WF-080/WF-081): choose calendars, disconnect (revoke + delete within 24 h), and
            mark a calendar "always private". Uses our own OAuth flow, not Clerk's (D30). */}
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
            disabled
          >
            Choose calendars
          </button>
          <button
            type="button"
            className={buttonVariants({
              variant: 'outline',
              size: 'sm',
              className: 'text-destructive',
            })}
            disabled
          >
            Disconnect
          </button>
        </div>
      </Panel>
    </SettingsPage>
  );
}
