import type { Route } from 'next';
import Link from 'next/link';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { FilePen } from 'lucide-react';
import { cn } from '@whosfree/ui/lib/utils';
import { textLinkClass } from '@/components/public/info-page';
import { isLegalDraft, legalValue, type LegalDocumentId, type LegalValueKey } from '@/lib/legal';
import { readLegalDocument } from '@/lib/legal-docs';
import { LEGAL_MARK_CLASS, remarkLegal } from '@/lib/legal-remark';

const markClass =
  'rounded-sm bg-status-soon-soft px-1 font-medium text-status-soon-ink box-decoration-clone';

/** Styles each element the markdown produces, with the app's tokens. */
const components: Components = {
  h2: ({ children }) => (
    <h2 className="mt-10 mb-3 text-lg font-semibold text-foreground">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-7 mb-2 text-base font-semibold text-foreground">{children}</h3>
  ),
  p: ({ children }) => <p className="my-3 leading-relaxed">{children}</p>,
  ul: ({ children }) => <ul className="my-3 flex list-disc flex-col gap-1.5 pl-5">{children}</ul>,
  ol: ({ children }) => (
    <ol className="my-3 flex list-decimal flex-col gap-1.5 pl-5">{children}</ol>
  ),
  li: ({ children }) => <li className="pl-1 leading-relaxed">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  hr: () => <hr className="my-8 border-border" />,
  code: ({ children }) => (
    <code className="rounded-sm bg-muted px-1 py-0.5 font-mono text-[0.9em] text-foreground">
      {children}
    </code>
  ),
  a: ({ href, children }) =>
    href?.startsWith('/') ? (
      <Link href={href as Route} className={textLinkClass}>
        {children}
      </Link>
    ) : (
      <a href={href} className={textLinkClass}>
        {children}
      </a>
    ),
  // Wide tables scroll inside their own box on phones, never the page. The box is focusable
  // so keyboard users can scroll it too.
  table: ({ children }) => (
    <div
      role="region"
      aria-label="Table"
      tabIndex={0}
      className="my-4 overflow-x-auto rounded-xl border bg-card focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <table className="w-full min-w-[32rem] border-collapse text-left text-sm">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th
      scope="col"
      className="border-b bg-muted px-3 py-2.5 align-bottom font-semibold text-foreground"
    >
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border-b border-border-subtle px-3 py-2.5 align-top">{children}</td>
  ),
  mark: ({ className, children }) => (
    <mark className={cn(markClass, className, className === LEGAL_MARK_CLASS.note && 'italic')}>
      {children}
    </mark>
  ),
};

/**
 * One of docs/legal/*.md, read and rendered at build time (FR-WEB-4, WF-010). The version and
 * placeholder values come from lib/legal.ts.
 */
export function LegalDocument({ id }: { id: LegalDocumentId }) {
  return (
    <article className="text-body-foreground">
      <Markdown remarkPlugins={[remarkGfm, remarkLegal]} components={components}>
        {readLegalDocument(id)}
      </Markdown>
    </article>
  );
}

/** Shown on the legal pages until the version is final and every value is filled in. */
export function LegalDraftNotice({ children }: { children?: React.ReactNode }) {
  if (!isLegalDraft()) return null;
  return (
    <div
      role="note"
      className="flex gap-3 rounded-xl border border-status-soon/40 bg-status-soon-soft p-4 text-sm text-status-soon-ink"
    >
      <FilePen aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <p>
        {children ?? (
          <>
            <strong className="font-semibold">Draft, not yet in effect.</strong> This text is still
            being reviewed. Highlighted items in square brackets are still to be filled in.
          </>
        )}
      </p>
    </div>
  );
}

/**
 * A single value from lib/legal.ts outside the markdown (e.g. on /contact): a mailto link for
 * emails, or the highlighted `[TOKEN]` while it's still unset.
 */
export function LegalValueText({ name }: { name: LegalValueKey }) {
  const v = legalValue(name);
  if (v.kind !== 'value') return <mark className={markClass}>{v.text}</mark>;
  return v.href ? (
    <a href={v.href} className={textLinkClass}>
      {v.text}
    </a>
  ) : (
    <>{v.text}</>
  );
}
