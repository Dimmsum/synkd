import type { Metadata, Route } from 'next';
import Link from 'next/link';
import { Check, UserRoundX } from 'lucide-react';
import { buttonVariants } from '@whosfree/ui/components/button';
import { EmptyState } from '@whosfree/ui/components/misc';
import { PersonAvatar } from '@whosfree/ui/components/person-avatar';
import { PageHeader } from '@/components/app/page-header';
import { AddFromLinkForm } from '@/components/friends/add-from-link';
import { getProfile } from '@/lib/data/social';
import { toPublicPerson } from '@/lib/social/mappers';

export const metadata: Metadata = { title: 'Add a friend', robots: { index: false } };

// A friend link, /add/<user id>, as shared or scanned from a QR code (FR-SOC-1, WF-042). Shows
// only the public profile (name, handle), through get_profile, which returns nothing across a
// block either way, so a blocked person sees the same as for a link that doesn't exist.
export default async function AddFriendPage({ params }: PageProps<'/add/[id]'>) {
  const row = await getProfile((await params).id);
  const back = { href: '/friends' as Route, label: 'Friends' };

  if (!row) {
    return (
      <>
        <PageHeader title="Add a friend" back={back} />
        <EmptyState icon={UserRoundX} title="We couldn’t find that person">
          The link may be mistyped. Ask them to share it again.
        </EmptyState>
      </>
    );
  }

  const person = toPublicPerson(row);
  const first = person.name.split(' ')[0] ?? person.name;

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col">
      <PageHeader title="Add a friend" back={back} />
      <section className="mb-5 flex items-center gap-3 rounded-2xl border bg-card p-4">
        <PersonAvatar name={person.name} hue={person.hue} size="lg" />
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-semibold">{person.name}</span>
          {person.handle ? (
            <span className="text-sm text-muted-foreground">@{person.handle}</span>
          ) : null}
        </span>
      </section>
      {person.relationship === 'self' ? (
        <p className="text-body-foreground">
          This is your own friend link. Share it so friends can add you.
        </p>
      ) : person.relationship === 'friend' ? (
        <div className="flex flex-col gap-3">
          <p className="flex items-center gap-2 text-body-foreground">
            <Check aria-hidden="true" className="size-4 text-status-free-ink" /> You&apos;re already
            friends.
          </p>
          <Link
            href={`/friends/${person.id}` as Route}
            className={buttonVariants({ className: 'w-fit' })}
          >
            See {first}
          </Link>
        </div>
      ) : person.relationship === 'request_sent' ? (
        <p className="text-body-foreground">
          Request sent. {first} chooses what you see when they accept.
        </p>
      ) : (
        <AddFromLinkForm
          personId={person.id}
          firstName={first}
          theyAsked={person.relationship === 'request_received'}
        />
      )}
    </div>
  );
}
