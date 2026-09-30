import type { Metadata } from 'next';
import Link from 'next/link';
import { InfoPage, textLinkClass } from '@/components/public/info-page';
import { LegalDraftNotice, LegalValueText } from '@/components/public/legal-document';
import { missingLegalValues } from '@/lib/legal';

export const metadata: Metadata = {
  title: 'Contact',
  description:
    "How to reach Who's Free: data and privacy requests, account help and security reports.",
};

// FR-WEB-4, NFR-COMP-2, WF-010. Public: readable without signing in. Email only, no form.
// Data requests are handled by email (WF-126) until self-serve export and deletion exist
// (WF-113, WF-114); update the "Your data" section when they ship.
export const dynamic = 'force-static';

export default function ContactPage() {
  return (
    <InfoPage title="Contact" intro="Email is the way to reach us. We don't have a contact form.">
      {missingLegalValues().length > 0 ? (
        <LegalDraftNotice>
          <strong className="font-semibold">Contact details are still being set up.</strong>{' '}
          Highlighted items in square brackets are still to be filled in.
        </LegalDraftNotice>
      ) : null}

      <section>
        <h2>Your data and privacy</h2>
        <p className="mt-2">
          Email <LegalValueText name="privacyEmail" /> to get a copy of your data, correct it,
          delete your account and data, or object to how we use it.
        </p>
        <p className="mt-2">
          Send it from the email address on your account so we know it&apos;s you. We&apos;ll
          complete it within 30 days. Self-serve export and deletion in Settings are on the way;
          until then, email is how we handle these requests.
        </p>
        <p className="mt-2">
          Not on Who&apos;s Free, but think someone added your schedule without your permission?
          Email the same address and we&apos;ll help. The{' '}
          <Link href="/privacy" className={textLinkClass}>
            privacy policy
          </Link>{' '}
          explains what we hold and why.
        </p>
      </section>

      <section>
        <h2>Help with your account</h2>
        <p className="mt-2">
          Email <LegalValueText name="supportEmail" />. For quick answers, see{' '}
          <Link href="/help" className={textLinkClass}>
            Help
          </Link>
          .
        </p>
      </section>

      <section>
        <h2>Report a person, group or ping</h2>
        <p className="mt-2">
          Use <strong className="text-foreground">Report</strong> in the app. It reaches us with the
          details we need, and you can block the person straight away. The{' '}
          <Link href="/terms" className={textLinkClass}>
            terms
          </Link>{' '}
          say what isn&apos;t allowed.
        </p>
      </section>

      <section>
        <h2>Report a security issue</h2>
        <p className="mt-2">
          Email <LegalValueText name="securityEmail" />. Please don&apos;t test against other
          people&apos;s accounts or data.
        </p>
      </section>

      <section>
        <h2>Who we are</h2>
        <address className="mt-2 not-italic">
          <LegalValueText name="entityName" />
          <br />
          <LegalValueText name="registeredAddress" />, Jamaica
        </address>
        <p className="mt-2">
          You can also complain to Jamaica&apos;s Office of the Information Commissioner:{' '}
          <LegalValueText name="oicContact" />.
        </p>
      </section>
    </InfoPage>
  );
}
