import { DEFAULT_GROUP_MAX_MEMBERS } from '@synkd/shared';

/**
 * Legal pages: the one place to fill in the values the privacy policy and terms leave open
 * (FR-WEB-4, WF-010), and the version users accept (FR-SET-5, WF-015).
 *
 * The text lives in docs/legal/*.md. Values the owner hasn't decided yet are written there as
 * `[CAPITALS]` tokens and filled from `LEGAL_VALUES` below when the pages are built. A value left
 * as `TODO` renders visibly as its `[TOKEN]`, highlighted, and the pages show a draft banner
 * until every value is set. Don't type these values into the markdown: fill them in here.
 */

// ---------------------------------------------------------------------------------------------
// Version
// ---------------------------------------------------------------------------------------------

/**
 * Version of the terms and privacy policy, shown on both pages and accepted at sign-up.
 *
 * Both documents share one version, because the database keeps one: `users.consent_version`,
 * checked against `public.current_consent_version()` (migration `*_consent_record.sql`, WF-015).
 * The two strings must be identical; `legal.test.ts` fails if they drift.
 *
 * To publish changed legal text (a "bump"):
 * 1. Edit docs/legal/privacy-policy.md and/or docs/legal/terms.md.
 * 2. Change `LEGAL_VERSION` here (e.g. '0.1-draft' → '1.0' at launch, then '1.1', …).
 * 3. In the same change, add a migration that runs
 *    `create or replace function public.current_consent_version() … select '<new version>'::text`
 *    (keeping its `set search_path = ''` and grants), and regenerate supabase/init.sql.
 * 4. Apply the migration when the new pages deploy. From then on every user whose recorded
 *    version differs is asked to accept again (`account_status().consent_required`), and
 *    `accept_consent()` refuses any other version, so the web and the database must agree.
 *
 * Only bump for changes users should re-accept. Filling in a placeholder value below is part of
 * publishing the first version, not a separate bump.
 */
export const LEGAL_VERSION = '0.1-draft';

// ---------------------------------------------------------------------------------------------
// Placeholder values
// ---------------------------------------------------------------------------------------------

/** Marks a value the owner still has to supply. Renders as the visible `[TOKEN]`. */
const TODO = null;

export interface LegalValue {
  /** The token as written in docs/legal/*.md, without the brackets. */
  readonly token: string;
  /** The final value, or `TODO` (null) while undecided. */
  readonly value: string | null;
  /** Emails render as mailto links. */
  readonly kind?: 'email';
  /** What the owner has to decide, and which issue decides it. */
  readonly todo: string;
}

export const LEGAL_VALUES = {
  entityName: {
    token: 'LEGAL ENTITY NAME',
    value: TODO,
    todo: 'Registered name of the company or person operating the service (WF-011, WF-119).',
  },
  registeredAddress: {
    token: 'REGISTERED ADDRESS',
    value: TODO,
    todo: 'Registered postal address in Jamaica (WF-119).',
  },
  domain: {
    token: 'DOMAIN',
    value: TODO,
    todo: 'Production domain without https://, e.g. "example.com" (WF-011).',
  },
  effectiveDate: {
    token: 'EFFECTIVE DATE',
    value: TODO,
    todo: 'Date this version takes effect, written out, e.g. "1 December 2026". Set it when publishing after legal review (WF-119).',
  },
  privacyEmail: {
    token: 'PRIVACY EMAIL',
    value: TODO,
    kind: 'email',
    todo: 'Inbox for privacy and data requests (access, correction, deletion) (WF-126).',
  },
  supportEmail: {
    token: 'SUPPORT EMAIL',
    value: TODO,
    kind: 'email',
    todo: 'Inbox for account help and disputes. May be the same as the privacy inbox.',
  },
  securityEmail: {
    token: 'SECURITY EMAIL',
    value: TODO,
    kind: 'email',
    todo: 'Inbox for responsible disclosure of security issues. May be the same as support.',
  },
  dataProtectionOfficer: {
    token: 'DATA PROTECTION OFFICER',
    value: TODO,
    todo: 'Name of the Data Protection Officer, or "Not required" if counsel confirms so (WF-119).',
  },
  oicContact: {
    token: 'OIC CONTACT DETAILS',
    value: TODO,
    todo: "Contact details of Jamaica's Office of the Information Commissioner (website and/or email).",
  },
  consentRecordRetention: {
    token: 'CONSENT RECORD RETENTION',
    value: TODO,
    todo: 'How long consent records are kept, e.g. "For the life of the account plus X years, to show consent was given".',
  },
  reportRetention: {
    token: 'REPORT RETENTION',
    value: TODO,
    todo: 'How long reports are kept, e.g. "1 year after the report is resolved".',
  },
  analyticsRetention: {
    token: 'ANALYTICS RETENTION',
    value: TODO,
    todo: 'How long analytics and error reports are kept, e.g. "12 months for analytics, 90 days for error reports".',
  },
  backupRetention: {
    token: 'BACKUP RETENTION',
    value: TODO,
    todo: 'How long deleted data survives in backups, e.g. "Deleted data is removed from backups within 30 days".',
  },
  liabilityCap: {
    token: 'LIABILITY CAP',
    value: TODO,
    todo: 'Limit of liability in the terms, e.g. "JMD $X or the amount you paid us in the past 12 months, whichever is greater" (WF-119).',
  },
} satisfies Record<string, LegalValue>;

export type LegalValueKey = keyof typeof LEGAL_VALUES;

/**
 * Tokens filled from code rather than by the owner, so the documents can't disagree with the
 * product: the version above and shared limits from `@synkd/shared`.
 */
const DERIVED_TOKENS: Readonly<Record<string, string>> = {
  VERSION: LEGAL_VERSION,
  'GROUP MEMBER LIMIT': String(DEFAULT_GROUP_MAX_MEMBERS),
};

/** The values the owner still has to supply. Empty once the documents can be published. */
export function missingLegalValues(): LegalValue[] {
  return Object.values(LEGAL_VALUES).filter((v: LegalValue) => v.value === null);
}

/** Draft until the version is final and every value is filled in. */
export function isLegalDraft(): boolean {
  return LEGAL_VERSION.endsWith('-draft') || missingLegalValues().length > 0;
}

// ---------------------------------------------------------------------------------------------
// Tokens in the markdown
// ---------------------------------------------------------------------------------------------

/**
 * `[CAPITALS]` tokens in the documents. With a colon they're review notes for counsel
 * (`[COUNSEL: …]`, `[VERIFY: …]`); without one they're values filled from this file. Mixed-case
 * brackets such as markdown link text never match.
 */
export const LEGAL_TOKEN_PATTERN = /\[([A-Z][A-Z /]*[A-Z])(?::[^\]]*)?\]/g;

export type ResolvedToken =
  /** A filled-in value; `href` for emails. */
  | { readonly kind: 'value'; readonly text: string; readonly href?: string }
  /** A value still to be supplied (or an unknown token): shown as-is, highlighted. */
  | { readonly kind: 'placeholder'; readonly text: string }
  /** A `[COUNSEL: …]`-style note for the legal review: shown as-is, highlighted. */
  | { readonly kind: 'note'; readonly text: string };

const VALUES_BY_TOKEN = new Map<string, LegalValue>(
  Object.values(LEGAL_VALUES).map((v: LegalValue) => [v.token, v]),
);

/** Whether `token` (without brackets) is one this file knows how to fill. */
export function isKnownLegalToken(token: string): boolean {
  return token in DERIVED_TOKENS || VALUES_BY_TOKEN.has(token);
}

/** Resolves one full match of `LEGAL_TOKEN_PATTERN`, e.g. `[PRIVACY EMAIL]`. */
export function resolveLegalToken(match: string): ResolvedToken {
  if (match.includes(':')) return { kind: 'note', text: match };
  const token = match.slice(1, -1);
  const derived = DERIVED_TOKENS[token];
  if (derived !== undefined) return { kind: 'value', text: derived };
  const entry = VALUES_BY_TOKEN.get(token);
  if (!entry || entry.value === null) return { kind: 'placeholder', text: match };
  return entry.kind === 'email'
    ? { kind: 'value', text: entry.value, href: `mailto:${entry.value}` }
    : { kind: 'value', text: entry.value };
}

/** For pages that show a value directly (e.g. /contact) rather than through the markdown. */
export function legalValue(key: LegalValueKey): ResolvedToken {
  return resolveLegalToken(`[${LEGAL_VALUES[key].token}]`);
}

// ---------------------------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------------------------

export const LEGAL_DOCUMENTS = {
  privacy: { file: 'privacy-policy.md', href: '/privacy', title: 'Privacy policy' },
  terms: { file: 'terms.md', href: '/terms', title: 'Terms of service' },
} as const;

export type LegalDocumentId = keyof typeof LEGAL_DOCUMENTS;

/**
 * The part of a document that's published: from its `# Title` down. The note above the title
 * is for editors (draft status, how placeholders work) and the title is the page's own `<h1>`.
 */
export function publishedLegalMarkdown(source: string): string {
  const title = /^# .*$/m.exec(source);
  if (!title) throw new Error('Legal document has no "# Title" heading');
  return source.slice(title.index + title[0].length).trimStart();
}

/** Links between the documents are written as file names in the markdown. */
export function legalLinkHref(url: string): string {
  for (const doc of Object.values(LEGAL_DOCUMENTS)) {
    if (url === doc.file || url.endsWith(`/${doc.file}`)) return doc.href;
  }
  return url;
}
