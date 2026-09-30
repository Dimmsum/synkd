import type { Metadata } from 'next';
import { InfoPage } from '@/components/public/info-page';
import { LegalDocument, LegalDraftNotice } from '@/components/public/legal-document';
import { LEGAL_DOCUMENTS } from '@/lib/legal';

export const metadata: Metadata = {
  title: LEGAL_DOCUMENTS.terms.title,
  description:
    "The terms for using Who's Free: who can use it, acceptable use, friends, groups and pings, and how accurate availability is.",
};

// FR-WEB-4, NFR-COMP-7, WF-010. Rendered from docs/legal/terms.md at build time.
// Public: readable without signing in. Placeholder values and the version live in lib/legal.ts.
export const dynamic = 'force-static';

export default function TermsPage() {
  return (
    <InfoPage title={LEGAL_DOCUMENTS.terms.title}>
      <LegalDraftNotice />
      <LegalDocument id="terms" />
    </InfoPage>
  );
}
