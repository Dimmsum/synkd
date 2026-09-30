import type { Metadata } from 'next';
import { InfoPage } from '@/components/public/info-page';

export const metadata: Metadata = { title: 'Privacy policy' };

// TODO(WF-010): render docs/legal/privacy-policy.md (with its version number for WF-015)
// once the draft passes legal review (WF-119). This page is a placeholder.
export default function PrivacyPage() {
  return (
    <InfoPage
      title="Privacy policy"
      intro="The full policy is being finalised. Here's the short version."
    >
      <section>
        <h2>What we share</h2>
        <p>
          Only your availability, at the level you choose for each friend and group. Everyone starts
          at Free/Busy with times.
        </p>
      </section>
      <section>
        <h2>What we never store</h2>
        <p>
          Locations, rooms and addresses. Your full date of birth (we keep only the year). Your
          uploaded schedule file after you confirm it.
        </p>
      </section>
      <section>
        <h2>Google Calendar</h2>
        <p>
          We read your calendar only to work out when you&apos;re busy. Google data is never sold,
          never used for ads and never sent to AI models.
        </p>
      </section>
    </InfoPage>
  );
}
