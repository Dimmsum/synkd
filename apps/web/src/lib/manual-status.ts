// Manual status (FR-AVL-3, J5, D5, WF-063): checking what the status chip sends, and describing
// the viewer's own active override. Pure, so it can be tested without a database or a clock.

import {
  MANUAL_STATUS_LABELS,
  MANUAL_STATUS_TO_STATUS,
  ManualStatus,
  STATUS_LABEL_MAX_LENGTH,
  STATUS_OVERRIDE_MAX_DAYS,
  StatusLabel,
  LocalTime,
} from '@whosfree/shared';
import {
  addDays,
  dateKey,
  formatUntil,
  zonedTimeToInstant,
  type Instant,
} from '@whosfree/ui/lib/time';
import type { StatusText } from '@/lib/status';

const MAX_MS = STATUS_OVERRIDE_MAX_DAYS * 24 * 60 * 60_000;

/** What the chip sends. `until` is an ISO instant, or null for "until I change it". */
export interface ManualStatusInput {
  status: ManualStatus | null;
  until: string | null;
  label?: string | null;
}

/** Arguments for `set_status` (`Database['public']['Functions']['set_status']['Args']`). */
export interface SetStatusArgs {
  status: ManualStatus;
  label?: string;
  ends_at?: string;
}

export type ParsedStatusInput =
  | { ok: true; clear: true }
  | { ok: true; clear: false; args: SetStatusArgs }
  | { ok: false; error: string };

/**
 * Checks the chip's input against the same rules as `set_status`: a known status, an optional
 * label of at most 40 characters, and an end time in the future and at most 7 days away.
 * `status: null` means "back to automatic" (`clear_status`).
 */
export function parseStatusInput(input: ManualStatusInput, now: Instant): ParsedStatusInput {
  if (input.status === null) return { ok: true, clear: true };
  const status = ManualStatus.safeParse(input.status);
  if (!status.success) return { ok: false, error: 'Pick a status.' };

  const args: SetStatusArgs = { status: status.data };

  const rawLabel = input.label?.trim() ?? '';
  if (rawLabel) {
    const label = StatusLabel.safeParse(rawLabel);
    if (!label.success) {
      return {
        ok: false,
        error: `Keep the note to ${String(STATUS_LABEL_MAX_LENGTH)} characters, on one line.`,
      };
    }
    args.label = label.data;
  }

  if (input.until !== null) {
    const ends = Date.parse(input.until);
    const nowMs = new Date(now).getTime();
    if (Number.isNaN(ends)) return { ok: false, error: 'Pick when it should end.' };
    if (ends <= nowMs) return { ok: false, error: 'Pick an end time later than now.' };
    if (ends - nowMs > MAX_MS) {
      return {
        ok: false,
        error: `Pick an end time within ${String(STATUS_OVERRIDE_MAX_DAYS)} days, or “Until I change it”.`,
      };
    }
    args.ends_at = new Date(ends).toISOString();
  }

  return { ok: true, clear: false, args };
}

/**
 * The next time the clock reads `time` (HH:MM) in `timeZone`: later today, or tomorrow if that
 * time has already passed. For "until 4 PM". Null for a malformed time.
 */
export function nextLocalTime(time: string, now: Instant, timeZone: string): Date | null {
  if (!LocalTime.safeParse(time).success) return null;
  const [h, m] = time.split(':').map(Number) as [number, number];
  const today = dateKey(now, timeZone);
  const nowMs = new Date(now).getTime();
  const todayAt = zonedTimeToInstant(today, h * 60 + m, timeZone);
  return todayAt.getTime() > nowMs
    ? todayAt
    : zonedTimeToInstant(addDays(today, 1), h * 60 + m, timeZone);
}

/** The viewer's own active override, as read from `status_overrides`. */
export interface ActiveOverride {
  status: ManualStatus;
  label: string | null;
  endsAt: string | null;
}

/**
 * The chip's words for an active override: "Studying/Focused until 4:00 PM", or just
 * "Do not disturb" for "until I change it". Always text next to the icon, never colour alone
 * (NFR-UX-1). The optional note goes in `detail`.
 */
export function describeOverride(o: ActiveOverride, now: Instant, timeZone: string): StatusText {
  const name = MANUAL_STATUS_LABELS[o.status];
  return {
    tone: MANUAL_STATUS_TO_STATUS[o.status],
    label: o.endsAt ? `${name} until ${formatUntil(o.endsAt, now, timeZone)}` : name,
    ...(o.label ? { detail: o.label } : {}),
  };
}

/**
 * Picks the override in effect at `now` from the viewer's rows, as the engine does: started,
 * not yet ended, and the latest start wins. Rows with an unknown status are ignored.
 */
export function activeOverride(
  rows: readonly {
    status: string;
    label: string | null;
    starts_at: string;
    ends_at: string | null;
  }[],
  now: Instant,
): ActiveOverride | null {
  const nowMs = new Date(now).getTime();
  let best: (ActiveOverride & { start: number }) | null = null;
  for (const row of rows) {
    const start = Date.parse(row.starts_at);
    const end = row.ends_at === null ? Infinity : Date.parse(row.ends_at);
    if (!(start <= nowMs && nowMs < end)) continue;
    const status = ManualStatus.safeParse(row.status);
    if (!status.success) continue;
    if (!best || start > best.start) {
      best = { status: status.data, label: row.label, endsAt: row.ends_at, start };
    }
  }
  if (!best) return null;
  return { status: best.status, label: best.label, endsAt: best.endsAt };
}
