import type { AvailableHours, ManualStatus, Status } from '@whosfree/shared';

/**
 * A calendar event as the engine sees it: an id and a busy span. The engine never needs a
 * title or category, so callers can pass tier-redacted events (PRD §6.7).
 */
export interface ScheduleEvent {
  /** The `events` row id. Returned in {@link StatusCause} so callers can look up details. */
  readonly id: string;
  /** Start, UTC epoch ms. */
  readonly start: number;
  /** End, UTC epoch ms (exclusive). */
  readonly end: number;
  /**
   * Whether the event makes the user busy (PRD §9 `events.busy`). Defaults to `true`. Google
   * events marked free/transparent, declined or all-day are stored with `busy: false`
   * (FR-GCAL-6) and are ignored here.
   */
  readonly busy?: boolean;
}

/** One of the user's schedule sources (PRD §9 `sources`) with its events. */
export interface ScheduleSource {
  /** The `sources` row id. Optional; the engine doesn't use it. */
  readonly id?: string;
  readonly events: readonly ScheduleEvent[];
}

/**
 * A manual status (PRD §9 `statusOverrides`, FR-AVL-3). It applies during
 * `[startsAt, endsAt)`, or from `startsAt` onwards when `endsAt` is missing ("until I change it").
 *
 * When several overrides are active at once, the one that started last wins (ties go to the
 * one later in the list), so a newer status set by the user replaces an older one.
 */
export interface StatusOverride {
  /** The `statusOverrides` row id. Returned in {@link StatusCause} when present. */
  readonly id?: string;
  readonly status: ManualStatus;
  /** UTC epoch ms. */
  readonly startsAt: number;
  /** UTC epoch ms (exclusive), or `null`/missing for "until I change it". */
  readonly endsAt?: number | null;
}

/** Everything the engine needs to know about one user. */
export interface AvailabilityInput {
  /** The user's IANA timezone (`users.timezone`). Defaults to `DEFAULT_TIMEZONE`. */
  readonly timeZone?: string;
  /** `users.sharingPaused` (FR-VIS-6). When true the user is `paused` all the time. */
  readonly sharingPaused?: boolean;
  /**
   * Available hours in local time (FR-AVL-2). A weekday with no entry is `away` all day, so an
   * empty list means always away. Missing means the default, 08:00–22:00 every day (D24).
   */
  readonly availableHours?: readonly AvailableHours[];
  readonly overrides?: readonly StatusOverride[];
  /**
   * Every schedule source the user has (uploaded, manual, Google). A user with no sources is
   * `no_schedule` (D22); a source with no events still counts as a schedule.
   */
  readonly sources: readonly ScheduleSource[];
}

/**
 * Why a user has a status. Only `events` carries ids: callers attach the category or title
 * the viewer's tier allows (PRD §6.7).
 */
export type StatusCause =
  | { readonly type: 'paused' }
  | {
      readonly type: 'override';
      /** The status the user picked, e.g. `focused`, which viewers see as `busy`. */
      readonly manualStatus: ManualStatus;
      readonly overrideId?: string;
    }
  | { readonly type: 'no_schedule' }
  /** Busy because of these events (ids sorted, no duplicates). */
  | { readonly type: 'events'; readonly eventIds: readonly string[] }
  /** Away because it's outside available hours. */
  | { readonly type: 'outside_hours' }
  /** Free: inside available hours with nothing else going on. */
  | { readonly type: 'available' };

/** A span of time with one status and one cause. */
export interface StatusSegment {
  readonly start: number;
  readonly end: number;
  readonly status: Status;
  readonly cause: StatusCause;
}
