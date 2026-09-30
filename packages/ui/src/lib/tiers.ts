import { DEFAULT_TIER, TIER_LABELS, TIERS, type Tier } from '@whosfree/shared';

/** What each tier reveals (PRD §6.7). Examples use the PRD's wording. */
export const TIER_DETAILS: Record<Tier, { title: string; description: string; example: string }> = {
  1: {
    title: `${TIER_LABELS[1]} with times`,
    description: 'Only whether you’re free or busy, and until when.',
    example: 'Busy until 3:00 PM',
  },
  2: {
    title: TIER_LABELS[2],
    description: 'Adds the kind of thing you’re doing.',
    example: 'In class until 3:00 PM',
  },
  3: {
    title: TIER_LABELS[3],
    description: 'Adds event titles too.',
    example: 'COMP2140 Lecture until 3:00 PM',
  },
};

export function tierFromString(value: string): Tier {
  const n = Number(value);
  return (TIERS as readonly number[]).includes(n) ? (n as Tier) : DEFAULT_TIER;
}
