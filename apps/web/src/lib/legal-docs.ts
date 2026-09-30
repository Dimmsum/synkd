import { readFileSync } from 'node:fs';
import path from 'node:path';
import { LEGAL_DOCUMENTS, publishedLegalMarkdown, type LegalDocumentId } from '@/lib/legal';

/**
 * docs/legal at the repo root, the single source of the legal text (FR-WEB-4). `next build`,
 * `next dev` and Vitest all run with apps/web as the working directory. Read at build time only:
 * the pages are static, so nothing reads this at request time.
 */
export const LEGAL_DIR = path.resolve(process.cwd(), '../../docs/legal');

/** The whole file, editor's note included. */
export function readLegalSource(id: LegalDocumentId): string {
  return readFileSync(path.join(LEGAL_DIR, LEGAL_DOCUMENTS[id].file), 'utf8');
}

/** The published markdown: from below the `# Title` down. */
export function readLegalDocument(id: LegalDocumentId): string {
  return publishedLegalMarkdown(readLegalSource(id));
}
