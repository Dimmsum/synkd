// Constants shared by web, backend, worker and parser. The PRD reference is next to each one.

/** Statuses a viewer can see (PRD §6.6). */
export const STATUSES = ['free', 'busy', 'dnd', 'away', 'no_schedule', 'paused'] as const;
export type Status = (typeof STATUSES)[number];

/**
 * Statuses a user can set by hand (PRD §9 `statusOverrides`, J5).
 * `focused` ("Studying/Focused") is shown to viewers as `busy`.
 */
export const MANUAL_STATUSES = ['free', 'busy', 'dnd', 'away', 'focused'] as const;
type ManualStatus = (typeof MANUAL_STATUSES)[number];

export const MANUAL_STATUS_TO_STATUS = {
  free: 'free',
  busy: 'busy',
  dnd: 'dnd',
  away: 'away',
  focused: 'busy',
} as const satisfies Record<ManualStatus, Status>;

/** Visibility tiers (PRD §6.7, D1). T1 is the default and the minimum (D20). */
export const TIERS = [1, 2, 3] as const;
type Tier = (typeof TIERS)[number];
export const DEFAULT_TIER: Tier = 1;

export const TIER_LABELS = {
  1: 'Free/Busy',
  2: 'Category',
  3: 'Details',
} as const satisfies Record<Tier, string>;

/**
 * Event fields each tier reveals, on top of status and times.
 * There is no location field at any tier (D35).
 */
export const TIER_VISIBLE_EVENT_FIELDS = {
  1: [],
  2: ['category'],
  3: ['category', 'title'],
} as const satisfies Record<Tier, readonly ('category' | 'title')[]>;

/** Event categories (PRD §9 `events.category`, FR-IMP-3). */
export const EVENT_CATEGORIES = [
  'class',
  'lab',
  'tutorial',
  'work',
  'meeting',
  'event',
  'other',
] as const;

export const DAYS_OF_WEEK = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

/** Group member permissions (FR-SOC-8, D26). */
export const GROUP_PERMISSIONS = ['invite', 'manageMembers', 'editGroup', 'groupPing'] as const;
export type GroupPermission = (typeof GROUP_PERMISSIONS)[number];
export type GroupPermissions = Record<GroupPermission, boolean>;

export const DEFAULT_MEMBER_PERMISSIONS = {
  invite: true,
  manageMembers: false,
  editGroup: false,
  groupPing: true,
} as const satisfies GroupPermissions;

/** Default group size cap. Stored per group so it can be raised without a schema change (NFR-SCALE-4). */
export const DEFAULT_GROUP_MAX_MEMBERS = 20;

/** Ping templates (J3) and one-tap replies (FR-PING-4). */
export const PING_TEMPLATES = ['Free for food?', 'Wanna study?', 'Link up?', 'Call me'] as const;
export type PingTemplate = (typeof PING_TEMPLATES)[number];

export const PING_REPLIES = ["I'm down", 'In 10', "Can't right now"] as const;
export type PingReply = (typeof PING_REPLIES)[number];

/** Free-text ping limit, in characters (D31). */
export const PING_TEXT_MAX_LENGTH = 140;

/** Available hours default: 08:00–22:00 every day (D24). */
export const DEFAULT_AVAILABLE_HOURS = { start: '08:00', end: '22:00' } as const;

export const DEFAULT_TIMEZONE = 'America/Jamaica';

export const SOURCE_TYPES = ['upload', 'manual', 'gcal'] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export const PARSE_JOB_STATUSES = [
  'queued',
  'processing',
  'needs_review',
  'committed',
  'failed',
] as const;
export type ParseJobStatus = (typeof PARSE_JOB_STATUSES)[number];

/**
 * Realtime "changed" signals (PRD §8.1, FR-VIEW-3, NFR-PERF-3, D41). Each user has one private
 * Broadcast channel, `user:<users.id>`, that only they can join. Database triggers send
 * {@link NOW_CHANGED_EVENT} on it, with an empty payload, whenever something their Now screen
 * shows changes; the client then re-fetches `now_for_viewer`.
 */
export const REALTIME_USER_CHANNEL_PREFIX = 'user:';
export const NOW_CHANGED_EVENT = 'now_changed';

/** The private Realtime channel topic of the user with this `users.id`. */
export function userChannel(userId: string): string {
  return `${REALTIME_USER_CHANNEL_PREFIX}${userId}`;
}
