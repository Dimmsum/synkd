import type { Metadata } from 'next';
import Link from 'next/link';
import { TIER_DETAILS } from '@whosfree/ui/lib/tiers';
import { TIERS } from '@whosfree/shared';
import { InfoPage, textLinkClass } from '@/components/public/info-page';

export const metadata: Metadata = { title: 'Help' };

// FR-WEB-6 (Should). TODO(WF-111): fuller iOS install guide with screenshots.
export default function HelpPage() {
  return (
    <InfoPage title="Help" intro="Quick answers to common questions.">
      <section>
        <h2>What can people see about me?</h2>
        <p>You pick a level for every friend and group:</p>
        <ul className="mt-2 flex list-disc flex-col gap-1 pl-5">
          {TIERS.map((t) => (
            <li key={t}>
              <strong className="text-foreground">{TIER_DETAILS[t].title}:</strong>{' '}
              {TIER_DETAILS[t].description} For example, “{TIER_DETAILS[t].example}”.
            </li>
          ))}
        </ul>
        <p className="mt-2">Your location is never shared at any level.</p>
      </section>
      <section id="install" className="scroll-mt-20">
        <h2>How do I install it on iPhone?</h2>
        <p>
          Open Who&apos;s Free in Safari, tap the Share button, then “Add to Home Screen”. Open it
          from your home screen to turn on notifications (iOS 16.4 or later).
        </p>
      </section>
      <section>
        <h2>How do I delete my account or get a copy of my data?</h2>
        <p>
          Email us from the address you signed up with and we&apos;ll handle it within 30 days. The
          address is on the{' '}
          <Link href="/contact" className={textLinkClass}>
            contact page
          </Link>
          .
        </p>
      </section>
    </InfoPage>
  );
}
