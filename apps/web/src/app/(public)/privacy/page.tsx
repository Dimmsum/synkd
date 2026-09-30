import type { Metadata } from 'next';
import { InfoPage } from '@/components/public/info-page';
import { LegalDocument, LegalDraftNotice } from '@/components/public/legal-document';
import { LEGAL_DOCUMENTS } from '@/lib/legal';

export const metadata: Metadata = {
  title: LEGAL_DOCUMENTS.privacy.title,
  description:
    "What Who's Free collects, why, who can see it, how long it's kept, and your rights. Includes Google's Limited Use disclosure.",
};

// FR-WEB-4, NFR-COMP-4/5/8/9, WF-010. Rendered from docs/legal/privacy-policy.md at build time.
// Public: readable without signing in. Placeholder values and the version live in lib/legal.ts.
export const dynamic = 'force-static';

export default function PrivacyPage() {
  return (
    <InfoPage title={LEGAL_DOCUMENTS.privacy.title}>
      <LegalDraftNotice />
      <LegalDocument id="privacy" />
    </InfoPage>
  );
}
