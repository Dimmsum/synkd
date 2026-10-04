// Statuses for the Now screen (PRD §8.5 "Now screen", FR-VIEW-1, FR-AVL-4, D18, WF-064).
//
// The server reads each person's tier-redacted schedule (`now_for_viewer`, or the viewer's own
// rows under RLS) and runs @whosfree/availability over it here. Pure: no I/O and no clock, so
// every mapping is unit-tested. Rows are already redacted by Postgres (FR-VIS-5, D41); nothing
// here widens what a row says, it only turns it into words-ready view models.

import { DEFAULT_UNTIL_HORIZON_MS, timeline } from '@whosfree/availability';
import type {
  AvailabilityInput,
  ScheduleEvent,
  ScheduleSource,
  StatusCause,
  StatusOverride,
  StatusSegment,
} from '@whosfree/availability';
import type { NowConnection } from '@whosfree/backend';
import {
  AvailableHours,
  DateRange,
  DAYS_OF_WEEK,
  DEFAULT_AVAILABLE_HOURS,
  EventCategory,
  LocalDate,
  ManualStatus,
  type SchedulePeriod,
} from '@whosfree/shared';
import type { ActiveOverride, Activity, Connection, Presence, PresenceChange } from '@/lib/types';
import { hueFor } from '@/lib/hue';

/**
 * How far ahead the client is sent precomputed status changes, so it can move people between
 * sections as "until X" passes without polling (PRD §8.5 step 4). Past it, the client re-fetches.
 */
export const PRESENCE_LOOKAHEAD_MS = 24 * 60 * 60_000;
/** At most this many changes per person are sent ahead (keeps the Now payload small, NFR-PERF-1). */
export const MAX_UPCOMING_CHANGES = 16;

/** The engine's input plus the tier-redacted details the reasons are described from. */
export interface PresenceInput {
  engine: AvailabilityInput;
  /** Event id → what the viewer may know about it (category from T2, title from T3). */
  events: ReadonlyMap<string, { category: string | null; title: string | null }>;
  /** Override id → the manual status (label only at T3 for other people). */
  overrides: ReadonlyMap<string, ActiveOverride>;
}

/** Someone's status now, plus how it changes over the look-ahead (for the client timer). */
export interface ComputedPresence extends Presence {
  upcoming: PresenceChange[];
  refreshAt: string | null;
  /** The manual status in charge now, if any (for the viewer's own status chip). */
  override: ActiveOverride | null;
}

/** Shown when a person's status couldn't be worked out (WF-064): nothing ahead, no reason. */
export const UNKNOWN_PRESENCE: ComputedPresence = {
  status: 'unknown',
  until: null,
  nextFreeAt: null,
  upcoming: [],
  refreshAt: null,
  override: null,
};

const iso = (ms: number) => new Date(ms).toISOString();

function invalid(what: string): never {
  // Only a fixed description, never row contents (NFR-SEC-11).
  throw new TypeError(`Malformed ${what}`);
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isInstant = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isNullableString = (v: unknown): v is string | null => v === null || typeof v === 'string';

/** A tier-redacted `now_for_viewer` event (`NowEvent`). The jsonb arrives untyped, so check it. */
function toEvent(raw: unknown): ScheduleEvent & { category: string | null; title: string | null } {
  if (!isObject(raw) || typeof raw.id !== 'string') invalid('event');
  const { id, start, end, rrule, exdates, category, title } = raw;
  if (!isInstant(start) || !isInstant(end) || !isNullableString(rrule)) invalid('event');
  if (!isNullableString(category) || !isNullableString(title)) invalid('event');
  if (!Array.isArray(exdates) || !exdates.every(isInstant)) invalid('event');
  return { id, start, end, rrule, exdates, category, title };
}

function toPeriod(raw: unknown): SchedulePeriod | null {
  if (raw === null || raw === undefined) return null;
  if (!isObject(raw) || !Array.isArray(raw.exceptions)) invalid('period');
  const start = LocalDate.safeParse(raw.start);
  const end = LocalDate.safeParse(raw.end);
  if (!start.success || !end.success) invalid('period');
  // Same rule as the database: a malformed exception is dropped (it can only make someone look
  // busier, never freer), and exception labels are never passed on.
  const exceptions = raw.exceptions.flatMap((x) => {
    const r = DateRange.safeParse(x);
    return r.success ? [{ start: r.data.start, end: r.data.end }] : [];
  });
  return { start: start.data, end: end.data, exceptions };
}

function toOverride(raw: unknown): (StatusOverride & { label: string | null }) | null {
  if (!isObject(raw) || typeof raw.id !== 'string') invalid('override');
  const { id, status, label, startsAt, endsAt } = raw;
  if (!isInstant(startsAt) || !(endsAt === null || isInstant(endsAt))) invalid('override');
  if (!isNullableString(label)) invalid('override');
  const parsed = ManualStatus.safeParse(status);
  // A status this build doesn't know yet: skip it rather than guess what it means.
  return parsed.success ? { id, status: parsed.data, label, startsAt, endsAt } : null;
}

function buildInput(
  engine: Omit<AvailabilityInput, 'sources' | 'overrides'>,
  sources: { period: SchedulePeriod | null; events: ReturnType<typeof toEvent>[] }[],
  overrides: (StatusOverride & { label: string | null })[],
): PresenceInput {
  const events = new Map<string, { category: string | null; title: string | null }>();
  for (const s of sources) {
    for (const e of s.events) events.set(e.id, { category: e.category, title: e.title });
  }
  const byId = new Map<string, ActiveOverride>();
  for (const o of overrides) {
    if (o.id === undefined) continue;
    byId.set(o.id, {
      status: o.status,
      label: o.label,
      endsAt: o.endsAt === null || o.endsAt === undefined ? null : iso(o.endsAt),
    });
  }
  const scheduleSources: ScheduleSource[] = sources.map((s) => ({
    period: s.period,
    events: s.events,
  }));
  return { engine: { ...engine, sources: scheduleSources, overrides }, events, overrides: byId };
}

/**
 * One `now_for_viewer` row → the engine's input (`{ timeZone, sharingPaused, availableHours,
 * overrides, sources }`, as the migration documents). Throws a `TypeError` if the jsonb columns
 * don't have the documented shape.
 */
export function nowRowInput(row: NowConnection): PresenceInput {
  const hours: unknown = row.available_hours;
  const sources: unknown = row.sources;
  const overrides: unknown = row.overrides;
  if (!Array.isArray(sources) || !Array.isArray(overrides)) invalid('row');
  return buildInput(
    {
      ...(row.timezone ? { timeZone: row.timezone } : {}),
      sharingPaused: row.paused,
      // No prefs row (null) means the default 08:00–22:00 (D24).
      ...(hours === null ? {} : { availableHours: AvailableHours.array().parse(hours) }),
    },
    sources.map((s: unknown) => {
      if (!isObject(s) || !Array.isArray(s.events)) invalid('source');
      return { period: toPeriod(s.period), events: s.events.map(toEvent) };
    }),
    overrides.map(toOverride).filter((o) => o !== null),
  );
}

/** The viewer's own rows, read under RLS (WF-064). Columns as in `public.*`. */
export interface OwnRows {
  timezone: string;
  sharingPaused: boolean;
  /** `availability_prefs.weekly`, or null when there's no row (the default hours apply). */
  weekly: unknown;
  overrides: {
    id: string;
    status: string;
    label: string | null;
    starts_at: string;
    ends_at: string | null;
  }[];
  sources: {
    id: string;
    offline_friend_id: string | null;
    period_start: string | null;
    period_end: string | null;
    period_exceptions: unknown;
  }[];
  events: {
    id: string;
    source_id: string;
    offline_friend_id: string | null;
    starts_at: string;
    ends_at: string;
    rrule: string | null;
    exdates: string[];
    busy: boolean;
    category: string | null;
    title: string | null;
  }[];
}

/** Stored sources and their busy events → the engine's sources. Rows must already be one person's. */
function storedSources(
  sources: OwnRows['sources'],
  events: OwnRows['events'],
): { period: SchedulePeriod | null; events: ReturnType<typeof toEvent>[] }[] {
  const sourceIds = new Set(sources.map((s) => s.id));
  const eventsBySource = new Map<string, ReturnType<typeof toEvent>[]>();
  for (const e of events) {
    if (!sourceIds.has(e.source_id) || !e.busy) continue;
    const event = toEvent({
      id: e.id,
      start: Date.parse(e.starts_at),
      end: Date.parse(e.ends_at),
      rrule: e.rrule,
      exdates: e.exdates.map((d) => Date.parse(d)),
      category: e.category,
      title: e.title,
    });
    eventsBySource.set(e.source_id, [...(eventsBySource.get(e.source_id) ?? []), event]);
  }
  return sources.map((s) => ({
    period:
      s.period_start && s.period_end
        ? toPeriod({
            start: s.period_start,
            end: s.period_end,
            exceptions: Array.isArray(s.period_exceptions) ? s.period_exceptions : [],
          })
        : null,
    events: eventsBySource.get(s.id) ?? [],
  }));
}

/**
 * The viewer's own schedule → the engine's input. Rows of their offline friends (D44, WF-127)
 * are dropped: RLS lets the owner read them too, but they are never the owner's own schedule
 * and must not make the viewer look busy or "have a schedule". The viewer sees their own
 * details in full.
 */
export function ownPresenceInput(rows: OwnRows): PresenceInput {
  return buildInput(
    {
      timeZone: rows.timezone,
      sharingPaused: rows.sharingPaused,
      ...(rows.weekly === null || rows.weekly === undefined
        ? {}
        : { availableHours: AvailableHours.array().parse(rows.weekly) }),
    },
    storedSources(
      rows.sources.filter((s) => s.offline_friend_id === null),
      rows.events.filter((e) => e.offline_friend_id === null),
    ),
    rows.overrides.flatMap((o) => {
      const parsed = toOverride({
        id: o.id,
        status: o.status,
        label: o.label,
        startsAt: Date.parse(o.starts_at),
        endsAt: o.ends_at === null ? null : Date.parse(o.ends_at),
      });
      return parsed ? [parsed] : [];
    }),
  );
}

/**
 * How far ahead of the app server's clock a status change stamped by the database may land
 * (WF-132). `set_status` and `clear_status` stamp `starts_at`/`ends_at` with Postgres `now()`;
 * when the app server's clock runs behind the database's, the re-render right after the change
 * would otherwise see the old status still running and the new one not started yet.
 */
export const DB_CLOCK_TOLERANCE_MS = 5_000;

/**
 * The instant to work out the viewer's own status at: `now`, or the latest status boundary in
 * `(now, now + DB_CLOCK_TOLERANCE_MS]` if there is one. Statuses always start at the database's
 * `now()` and a closed one ends there, while an end the user picks is at least a minute away,
 * so a boundary that close is a change that has already happened by the database's clock.
 */
export function settleOwnNow(now: number, overrides: OwnRows['overrides']): number {
  let settled = now;
  for (const o of overrides) {
    for (const stamp of [o.starts_at, o.ends_at]) {
      if (stamp === null) continue;
      const t = Date.parse(stamp);
      if (t > settled && t <= now + DB_CLOCK_TOLERANCE_MS) settled = t;
    }
  }
  return settled;
}

/** Every day 08:00–22:00 (D24): an offline friend has no hours of their own (WF-128). */
export const OFFLINE_FRIEND_HOURS: AvailableHours[] = DAYS_OF_WEEK.map((day) => ({
  day,
  ...DEFAULT_AVAILABLE_HOURS,
}));

/**
 * One offline friend's schedule → the engine's input (D44, WF-128). Only rows with their
 * `offline_friend_id` count. They have no account, so no timezone, hours, manual status or
 * pause of their own: they're read in the owner's timezone with the default available hours.
 * The owner added the schedule, so they see its details in full (FR-SOC-15).
 */
export function offlineFriendPresenceInput(
  offlineFriendId: string,
  rows: Pick<OwnRows, 'timezone' | 'sources' | 'events'>,
): PresenceInput {
  return buildInput(
    { timeZone: rows.timezone, sharingPaused: false, availableHours: OFFLINE_FRIEND_HOURS },
    storedSources(
      rows.sources.filter((s) => s.offline_friend_id === offlineFriendId),
      rows.events.filter((e) => e.offline_friend_id === offlineFriendId),
    ),
    [],
  );
}

/** Why someone has a status, in what the viewer's tier allows (the rows are already redacted). */
export function activityFor(cause: StatusCause, input: PresenceInput): Activity | undefined {
  if (cause.type === 'events') {
    const details = cause.eventIds.map((id) => input.events.get(id)).filter((d) => d !== undefined);
    const title = details.find((d) => d.title)?.title ?? undefined;
    const category = EventCategory.safeParse(
      (details.find((d) => d.title) ?? details.find((d) => d.category))?.category,
    );
    const activity: Activity = {
      ...(category.success ? { category: category.data } : {}),
      ...(title ? { title } : {}),
    };
    return Object.keys(activity).length ? activity : undefined;
  }
  if (cause.type === 'override') {
    // `focused` only arrives from T2 up (the database sends plain `busy` below), and the
    // label only at T3 (WF-064 migration).
    const label = cause.overrideId ? input.overrides.get(cause.overrideId)?.label : null;
    const activity: Activity = {
      ...(cause.manualStatus === 'focused' ? { focused: true } : {}),
      ...(label ? { title: label } : {}),
    };
    return Object.keys(activity).length ? activity : undefined;
  }
  return undefined;
}

const samePresence = (a: Presence, b: Presence) =>
  a.status === b.status &&
  a.until === b.until &&
  a.nextFreeAt === b.nextFreeAt &&
  JSON.stringify(a.activity ?? null) === JSON.stringify(b.activity ?? null);

/**
 * Someone's status at `now` with "until X" (the same as `statusAt(input.engine, now)`), the
 * changes over the next {@link PRESENCE_LOOKAHEAD_MS}, and when the client must re-fetch.
 *
 * Runs the engine's `timeline` once over its default week-long look-ahead and reads every
 * moment's status from it, so `until` is the end of the unbroken run of the same status (D18)
 * and `nextFreeAt` the start of the next free time. Throws whatever the engine throws (e.g. a
 * `RangeError` for a malformed RRULE or an unknown timezone): callers catch it per person.
 */
export function computePresence(
  input: PresenceInput,
  now: number,
  opts: { lookaheadMs?: number; maxChanges?: number } = {},
): ComputedPresence {
  const lookahead = opts.lookaheadMs ?? PRESENCE_LOOKAHEAD_MS;
  const maxChanges = opts.maxChanges ?? MAX_UPCOMING_CHANGES;
  const segments = timeline(input.engine, { start: now, end: now + DEFAULT_UNTIL_HORIZON_MS });

  // From the end backwards: when each segment's run of the same status ends, and when the
  // person is next free after it.
  const until: (number | null)[] = [];
  const nextFree: (number | null)[] = [];
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i] as StatusSegment;
    const next = segments[i + 1];
    until[i] = !next ? null : next.status === seg.status ? (until[i + 1] ?? null) : next.start;
    nextFree[i] =
      seg.status === 'free' || !next
        ? null
        : next.status === 'free'
          ? next.start
          : (nextFree[i + 1] ?? null);
  }
  const presenceOf = (i: number): Presence => {
    const seg = segments[i] as StatusSegment;
    const u = until[i] ?? null;
    const f = nextFree[i] ?? null;
    const activity = activityFor(seg.cause, input);
    return {
      status: seg.status,
      until: u === null ? null : iso(u),
      nextFreeAt: f === null ? null : iso(f),
      ...(activity ? { activity } : {}),
    };
  };

  const current = presenceOf(0);
  const upcoming: PresenceChange[] = [];
  let refreshAt: string | null = null;
  let last = current;
  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i] as StatusSegment;
    const p = presenceOf(i);
    if (samePresence(p, last)) continue;
    if (seg.start > now + lookahead || upcoming.length >= maxChanges) {
      refreshAt = iso(seg.start);
      break;
    }
    upcoming.push({ at: iso(seg.start), ...p });
    last = p;
  }

  // The manual status in charge, even while sharing is paused (which outranks it, D5): the
  // owner's status chip still shows and pre-fills it.
  let cause = (segments[0] as StatusSegment).cause;
  if (cause.type === 'paused' && input.engine.overrides?.length) {
    const [unpaused] = timeline(
      { ...input.engine, sharingPaused: false },
      { start: now, end: now + 1 },
    );
    if (unpaused) cause = unpaused.cause;
  }
  const override =
    cause.type === 'override' && cause.overrideId
      ? (input.overrides.get(cause.overrideId) ?? null)
      : null;
  return { ...current, upcoming, refreshAt, override };
}

/** A short code for a failure, safe to log: the error's class name, never its message. */
export function errorCode(err: unknown): string {
  return err instanceof Error ? err.name : 'UnknownError';
}

/**
 * One `now_for_viewer` row → a Now screen {@link Connection} at `now`. A row the engine can't
 * handle (a bad RRULE or timezone, a malformed column) gives that one person an `unknown`
 * status instead of breaking the screen; `error` is then a code that is safe to log.
 */
export function nowRowToConnection(
  row: NowConnection,
  now: number,
): { connection: Connection; error: string | null } {
  let presence: ComputedPresence;
  let error: string | null = null;
  try {
    presence = computePresence(nowRowInput(row), now);
  } catch (err) {
    presence = UNKNOWN_PRESENCE;
    error = errorCode(err);
  }
  const { status, until, nextFreeAt, activity, upcoming, refreshAt } = presence;
  return {
    connection: {
      id: row.user_id,
      name: row.name,
      handle: row.handle ?? '',
      hue: hueFor(row.user_id),
      isFriend: row.relationship === 'friend',
      tier: row.tier,
      status,
      until,
      nextFreeAt,
      ...(activity ? { activity } : {}),
      // TODO(WF-067): "Schedule may be out of date" (FR-VIEW-8, D25) isn't in now_for_viewer yet.
      stale: false,
      groupIds: row.group_ids,
      upcoming,
      refreshAt,
    },
    error,
  };
}
