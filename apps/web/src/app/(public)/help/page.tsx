import type { Metadata } from 'next';
import Link from 'next/link';
import { TIER_DETAILS } from '@whosfree/ui/lib/tiers';
import { TIERS } from '@whosfree/shared';
import { InfoPage, textLinkClass } from '@/components/public/info-page';
import { InstallPrompt, IosInstallSteps } from '@/components/pwa/install-prompt';

export const metadata: Metadata = { title: 'Help' };

// FR-WEB-6 (Should). The install section (WF-111, FR-PWA-3) shows the prompt or guide for the
// visitor's device, dismissed or not, then the steps for each platform.
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
        <h2>How do I install it?</h2>
        <p>
          Who&apos;s Free is a web app you add to your home screen. Installed, it opens like any
          other app and can notify you when a friend pings you.
        </p>
        <InstallPrompt surface="requested" className="mt-4" />
        <h3 className="mt-6 font-semibold text-foreground">iPhone and iPad</h3>
        <p className="mb-3">
          Notifications only work once the app is on your Home Screen, on iOS 16.4 or later. Until
          then, pings show up in your inbox.
        </p>
        <IosInstallSteps />
        <h3 className="mt-6 font-semibold text-foreground">Android</h3>
        <p>
          In Chrome, tap <strong className="text-foreground">Install</strong> when Who&apos;s Free
          offers it, or open the menu ⋮ and tap{' '}
          <strong className="text-foreground">Install app</strong>. Then turn on notifications in
          Settings.
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
