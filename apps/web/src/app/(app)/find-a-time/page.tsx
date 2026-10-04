import type { Metadata } from 'next';
import { CalendarSearch } from 'lucide-react';
import { PageHeader } from '@/components/app/page-header';
import { ComingSoon } from '@/components/app/coming-soon';

export const metadata: Metadata = { title: 'Find a time' };

// Group slot finder (J4, FR-SLOT, WF-098). Until the server-side slot finder lands this says
// it's coming instead of showing results (WF-134).
// TODO(WF-098): the GET form (who, next 3/7/14 days, minimum length, time of day), ranked
// slots ("Everyone free", then "Almost everyone") and the overlap week.
export default function FindATimePage() {
  return (
    <>
      <PageHeader
        title="Find a time"
        subtitle="See when your group is free. We only show when people are free, never why they’re busy."
      />
      <ComingSoon icon={CalendarSearch} title="Finding a time together is coming soon">
        For now, check who’s free on Now, or open a friend or group to see their status.
      </ComingSoon>
    </>
  );
}
