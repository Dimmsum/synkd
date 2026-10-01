import type { Route } from 'next';
import Link from 'next/link';
import { Check } from 'lucide-react';
import { buttonVariants } from '@whosfree/ui/components/button';
import { PersonAvatar } from '@whosfree/ui/components/person-avatar';
import { PageHeader } from '@/components/app/page-header';
import { AddFromLinkForm } from '@/components/friends/add-from-link';
import type { PublicPerson } from '@/lib/types';

/**
 * Adding the person behind a friend link (/add/<id>) or a friend invite link (/join/<code>,
 * WF-042): their public profile (name, handle), then what fits how you're connected. Only ever
 * shown for a profile the database returned, which it never does across a block (FR-SOC-6).
 */
export function AddPersonView({
  person,
  inviteCode,
}: {
  person: PublicPerson;
  /** Set when coming from a friend invite link: the request goes through it. */
  inviteCode?: string;
}) {
  const first = person.name.split(' ')[0] ?? person.name;
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col">
      <PageHeader title="Add a friend" back={{ href: '/friends' as Route, label: 'Friends' }} />
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
          This is your own {inviteCode ? 'invite' : 'friend'} link. Share it so friends can add you.
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
          {...(inviteCode ? { inviteCode } : {})}
        />
      )}
    </div>
  );
}
