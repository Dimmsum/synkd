import type { Metadata, Route } from 'next';
import { UserRoundX } from 'lucide-react';
import { EmptyState } from '@synkd/ui/components/misc';
import { PageHeader } from '@/components/app/page-header';
import { AddPersonView } from '@/components/friends/add-person';
import { getProfile } from '@/lib/data/social';
import { toPublicPerson } from '@/lib/social/mappers';

export const metadata: Metadata = { title: 'Add a friend', robots: { index: false } };

// A friend link, /add/<user id>, as shared or scanned from a QR code (FR-SOC-1, WF-042). Shows
// only the public profile (name, handle), through get_profile, which returns nothing across a
// block either way, so a blocked person sees the same as for a link that doesn't exist. Friend
// invite links (/i/<code>, revocable) end up on /join/<code>, which shows the same view.
export default async function AddFriendPage({ params }: PageProps<'/add/[id]'>) {
  const row = await getProfile((await params).id);

  if (!row) {
    return (
      <>
        <PageHeader title="Add a friend" back={{ href: '/friends' as Route, label: 'Friends' }} />
        <EmptyState icon={UserRoundX} title="We couldn’t find that person">
          The link may be mistyped. Ask them to share it again.
        </EmptyState>
      </>
    );
  }

  return <AddPersonView person={toPublicPerson(row)} />;
}
