import { DEFAULT_TIMEZONE } from '@whosfree/shared';
import { LEGAL_VERSION } from '@/lib/legal';

/**
 * Versions of the legal documents the user accepts at sign-up (FR-SET-5, WF-015). Both come
 * from `LEGAL_VERSION` in lib/legal.ts, which the pages show and which must match the
 * database's `current_consent_version()`; see there for how to bump it.
 */
export const LEGAL_VERSIONS = {
  terms: LEGAL_VERSION,
  privacy: LEGAL_VERSION,
} as const;

/** Timezone used until we know the viewer's own (FR-AUTH-3). */
export const FALLBACK_TIMEZONE = DEFAULT_TIMEZONE;
