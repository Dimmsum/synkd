import type { Metadata } from 'next';
import { InfoPage } from '@/components/public/info-page';

export const metadata: Metadata = { title: 'Terms of service' };

// TODO(WF-010): render docs/legal/terms.md once it passes legal review (WF-119).
export default function TermsPage() {
  return (
    <InfoPage title="Terms of service" intro="The full terms are being finalised.">
      <section>
        <h2>Who can use Who&apos;s Free</h2>
        <p>You must be 18 or older to use Who&apos;s Free.</p>
      </section>
      <section>
        <h2>Be decent</h2>
        <p>
          Pings are for linking up, not for spam or harassment. You can report or block anyone in
          one tap.
        </p>
      </section>
    </InfoPage>
  );
}
