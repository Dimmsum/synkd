// What to call someone in a sentence ("What Alice will see", WF-136).

import { DEFAULT_DISPLAY_NAME } from '@whosfree/shared';

/**
 * The first word of their name, or `@handle` while the name is still the default one sign-up
 * gave them: "What New will see" means nothing.
 */
export function shortName(person: { name: string; handle?: string | null }): string {
  if (person.name === DEFAULT_DISPLAY_NAME && person.handle) return `@${person.handle}`;
  return person.name.split(' ')[0] || person.name;
}
