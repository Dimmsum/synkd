import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_GROUP_MAX_MEMBERS } from '@synkd/shared';
import { LegalDocument } from '@/components/public/legal-document';
import {
  LEGAL_DOCUMENTS,
  LEGAL_TOKEN_PATTERN,
  LEGAL_VALUES,
  LEGAL_VERSION,
  isKnownLegalToken,
  legalLinkHref,
  missingLegalValues,
  publishedLegalMarkdown,
  resolveLegalToken,
  type LegalDocumentId,
} from '@/lib/legal';
import { readLegalDocument } from '@/lib/legal-docs';
import { LEGAL_VERSIONS } from '@/lib/config';

const IDS = Object.keys(LEGAL_DOCUMENTS) as LegalDocumentId[];

/** The string the newest migration makes `current_consent_version()` return. */
function databaseConsentVersion(): string {
  const dir = path.resolve(process.cwd(), '../../packages/backend/supabase/migrations');
  const definitions = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => readFileSync(path.join(dir, f), 'utf8'))
    .flatMap((sql) => [
      ...sql.matchAll(
        /function public\.current_consent_version\(\)\s+returns text[\s\S]*?\$\$\s*select\s+'([^']+)'::text/g,
      ),
    ]);
  const latest = definitions.at(-1)?.[1];
  if (!latest) throw new Error('No migration defines current_consent_version()');
  return latest;
}

describe('legal version (WF-010, WF-015)', () => {
  it('matches the version the database asks users to accept', () => {
    // A bump changes LEGAL_VERSION and ships a migration redefining current_consent_version().
    expect(LEGAL_VERSION).toBe(databaseConsentVersion());
  });

  it('is the version accepted at sign-up for both documents', () => {
    expect(LEGAL_VERSIONS).toEqual({ terms: LEGAL_VERSION, privacy: LEGAL_VERSION });
  });

  it.each(IDS)('is shown in the %s document, with its effective date', (id) => {
    const md = readLegalDocument(id);
    expect(md).toContain('**Version:** [VERSION]');
    expect(md).toContain('**Effective date:** [EFFECTIVE DATE]');
  });
});

describe('placeholders (WF-010)', () => {
  it.each(IDS)('every [TOKEN] in the %s document is filled from lib/legal.ts', (id) => {
    const tokens = [...readLegalDocument(id).matchAll(LEGAL_TOKEN_PATTERN)]
      .map((m) => m[0])
      .filter((t) => !t.includes(':'))
      .map((t) => t.slice(1, -1));
    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens.filter((t) => !isKnownLegalToken(t))).toEqual([]);
  });

  it('every value in lib/legal.ts is used by a document', () => {
    const text = IDS.map(readLegalDocument).join('\n');
    for (const v of Object.values(LEGAL_VALUES)) expect(text).toContain(`[${v.token}]`);
  });

  it('lists what the owner still has to supply', () => {
    const missing = missingLegalValues();
    expect(missing.every((v) => v.value === null && v.todo.length > 0)).toBe(true);
  });

  it('fills derived values from code', () => {
    expect(resolveLegalToken('[VERSION]')).toEqual({ kind: 'value', text: LEGAL_VERSION });
    expect(resolveLegalToken('[GROUP MEMBER LIMIT]')).toEqual({
      kind: 'value',
      text: String(DEFAULT_GROUP_MAX_MEMBERS),
    });
  });

  it('keeps unset values and counsel notes visible', () => {
    expect(resolveLegalToken('[NOT A REAL TOKEN]')).toEqual({
      kind: 'placeholder',
      text: '[NOT A REAL TOKEN]',
    });
    expect(resolveLegalToken('[COUNSEL: check this]')).toEqual({
      kind: 'note',
      text: '[COUNSEL: check this]',
    });
  });

  it('does not treat markdown link text as a token', () => {
    expect('[Privacy Policy](privacy-policy.md) [Google API]'.match(LEGAL_TOKEN_PATTERN)).toBe(
      null,
    );
  });
});

describe('publishedLegalMarkdown', () => {
  it('drops the editor note and the title', () => {
    expect(publishedLegalMarkdown('> note\n\n# Title\n\nBody')).toBe('Body');
  });

  it('refuses a document without a title', () => {
    expect(() => publishedLegalMarkdown('Body')).toThrow(/Title/);
  });

  it('points links between the documents at their routes', () => {
    expect(legalLinkHref('privacy-policy.md')).toBe('/privacy');
    expect(legalLinkHref('./terms.md')).toBe('/terms');
    expect(legalLinkHref('https://example.com/terms.md.html')).toBe(
      'https://example.com/terms.md.html',
    );
  });
});

describe('offline friends coverage (D44, NFR-COMP-9)', () => {
  it('the privacy policy explains what is held, who sees it, deletion and the basis', () => {
    const md = readLegalDocument('privacy');
    expect(md).toMatch(/offline friends/i);
    expect(md).toMatch(/nickname/);
    expect(md).toMatch(/Only you can see an offline friend/);
    expect(md).toMatch(/deleting one removes their schedule \*\*straight away\*\*/);
    expect(md).toMatch(/\*\*Legal basis\.\*\*[^\n]*permission/);
  });

  it("the terms require the person's permission", () => {
    const md = readLegalDocument('terms');
    expect(md).toMatch(/You must have their permission first/);
    expect(md).toMatch(
      /offline friend\*\*, or upload or enter their schedule, \*\*without their permission/,
    );
  });
});

describe('<LegalDocument>', () => {
  const html = (id: LegalDocumentId) => renderToStaticMarkup(createElement(LegalDocument, { id }));

  it('renders the body without the editor note or a second h1', () => {
    const out = html('privacy');
    expect(out).not.toContain('<h1');
    expect(out).not.toContain('NOT YET IN EFFECT');
    expect(out).toContain('<h2');
    expect(out).toContain('<table');
  });

  it('shows the version and highlights unfilled values', () => {
    const out = html('terms');
    expect(out).toContain(LEGAL_VERSION);
    expect(out).not.toContain('[VERSION]');
    if (LEGAL_VALUES.entityName.value === null) {
      expect(out).toMatch(
        /<mark class="[^"]*\blegal-placeholder\b[^"]*">\[LEGAL ENTITY NAME\]<\/mark>/,
      );
    }
    expect(out).toContain(`limit of ${DEFAULT_GROUP_MAX_MEMBERS} members`);
  });

  it('links the terms to the privacy page', () => {
    expect(html('terms')).toContain('href="/privacy"');
  });
});
