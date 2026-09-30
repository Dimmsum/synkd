import { DEFAULT_TIMEZONE } from '@whosfree/shared';
import { dateKey, zonedTimeToInstant } from '@whosfree/ui/lib/time';

/**
 * The mock clock. By default it's **today at 2:30 PM in Jamaica**, so every Now section
 * has people in it whatever time you open the app (the design uses the same moment).
 *
 * Set `WHOSFREE_MOCK_NOW` to an ISO instant to pin another moment, or to `real` to use
 * the actual time.
 *
 * TODO(WF-064): delete with the mock layer; the server uses the real time.
 */
export function getMockNow(): Date {
  const env = process.env.WHOSFREE_MOCK_NOW;
  if (env === 'real') return new Date();
  if (env) return new Date(env);
  const today = dateKey(new Date(), DEFAULT_TIMEZONE);
  return zonedTimeToInstant(today, 14 * 60 + 30, DEFAULT_TIMEZONE);
}
