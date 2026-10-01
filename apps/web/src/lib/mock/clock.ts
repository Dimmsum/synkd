import { DEFAULT_TIMEZONE } from '@whosfree/shared';
import { dateKey, zonedTimeToInstant } from '@whosfree/ui/lib/time';

/**
 * The mock clock, for the mock data that's left (group timelines and slots, the inbox, uploads;
 * see selectors.ts). By default it's **today at 2:30 PM in Jamaica**, the moment the design
 * uses. Real screens (Now, statuses, the viewer) use the real clock since WF-064 (`getNow`).
 *
 * Set `WHOSFREE_MOCK_NOW` to an ISO instant to pin another moment, or to `real` to use
 * the actual time.
 *
 * TODO(WF-066/WF-098): delete with the last of the mock layer.
 */
export function getMockNow(): Date {
  const env = process.env.WHOSFREE_MOCK_NOW;
  if (env === 'real') return new Date();
  if (env) return new Date(env);
  const today = dateKey(new Date(), DEFAULT_TIMEZONE);
  return zonedTimeToInstant(today, 14 * 60 + 30, DEFAULT_TIMEZONE);
}
