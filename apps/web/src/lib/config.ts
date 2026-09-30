import { DEFAULT_TIMEZONE } from '@whosfree/shared';

/**
 * Versions of the legal documents the user accepts at sign-up (FR-SET-5, WF-015).
 * TODO(WF-010): read these from the published policy documents instead.
 */
export const LEGAL_VERSIONS = {
  terms: 'draft-2026-09',
  privacy: 'draft-2026-09',
} as const;

/** Timezone used until we know the viewer's own (FR-AUTH-3). */
export const FALLBACK_TIMEZONE = DEFAULT_TIMEZONE;
