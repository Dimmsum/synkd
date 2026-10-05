// View models the screens render. Data-access functions in `lib/data/` return these.
// They're shaped like what the server will send: other people's data arrives already
// redacted to the viewer's tier (FR-VIS-5), so screens never decide what to hide.

import type {
  DateRange,
  DayOfWeek,
  EventCategory,
  EventDraft,
  GroupPermissions,
  LocalTime,
  ManualStatus,
  ParseErrorCode,
  ParseJobStatus,
  PingReply,
  PingTemplate,
  SourceType,
  Status,
  Tier,
} from '@synkd/shared';

export type PersonId = string;
export type GroupId = string;
/** An instant as an ISO 8601 string (UTC). */
export type Iso = string;

export interface Person {
  id: PersonId;
  name: string;
  handle: string;
  /** Stable avatar hue, 0–360. */
  hue: number;
}

/** What the viewer is allowed to know about what someone is doing (tier-redacted). */
export interface Activity {
  /** T2 and up. */
  category?: EventCategory;
  /** T3 only: an event's title, or the note on a manual status (WF-063). */
  title?: string;
  /** T2 and up: a manual "Studying/Focused" status, which T1 sees as plain busy (FR-AVL-3). */
  focused?: boolean;
}

/**
 * A status as screens show it: a viewer-visible status (PRD §6.6), or `unknown` when it couldn't
 * be worked out for this person (e.g. a malformed recurrence rule), so one bad schedule never
 * breaks the Now screen (WF-064).
 */
export type PresenceStatus = Status | 'unknown';

/** Someone's status at one moment, with "until X" (FR-AVL-4, D18). */
export interface Presence {
  status: PresenceStatus;
  /** When the status next changes ("until X", D18). `null` if not within a week (or ever). */
  until: Iso | null;
  /** When they're next free, if they aren't free now. */
  nextFreeAt: Iso | null;
  /** Why they have this status, redacted to their tier for the viewer. */
  activity?: Activity;
}

/** A later moment from which someone's {@link Presence} is different (PRD §8.5 step 4). */
export interface PresenceChange extends Presence {
  at: Iso;
}

/** Someone the viewer can see: a friend, or a fellow group member (FR-SOC-5). */
export interface Connection extends Person, Presence {
  isFriend: boolean;
  /** The tier this person shows the viewer, already resolved (FR-VIS-3). */
  tier: Tier;
  /** Show "Schedule may be out of date" (FR-VIEW-8, D25). */
  stale: boolean;
  groupIds: GroupId[];
  /**
   * How their status changes after the moment it was worked out, in order, so the Now screen
   * can move people between sections as "until X" passes without asking the server (PRD §8.5
   * step 4). Missing or empty when nothing is known ahead.
   */
  upcoming?: PresenceChange[];
  /**
   * When `upcoming` runs out and the client must re-fetch: the first change the server knew
   * of but didn't send. Missing or `null` when nothing more is known.
   */
  refreshAt?: Iso | null;
}

/**
 * Someone not on synkd whom the viewer added (D44, FR-SOC-14), with their status now. Only
 * ever the viewer's own: nobody else can see them (FR-SOC-15). They can't be pinged (FR-SOC-17).
 */
export interface OfflineFriendView extends Presence {
  id: string;
  nickname: string;
  emoji: string | null;
  /** False until a schedule is confirmed for them; their status is then `no_schedule`. */
  hasSchedule: boolean;
  /** As on {@link Connection}: how their status changes ahead, for the Now screen's timer. */
  upcoming?: PresenceChange[];
  refreshAt?: Iso | null;
}

/** A manual status in effect (WF-063): what the status chip shows and pre-fills. */
export interface ActiveOverride {
  status: ManualStatus;
  label: string | null;
  endsAt: Iso | null;
}

export interface Viewer extends Person, Presence {
  timeZone: string;
  sharingPaused: boolean;
  /** The viewer's own manual status in effect, if any (J5, FR-AVL-3). */
  manual: ActiveOverride | null;
}

export interface GroupSummary {
  id: GroupId;
  name: string;
  emoji: string;
  memberCount: number;
  freeNowCount: number;
  viewerRole: 'admin' | 'member';
}

/** A busy block on someone else's timeline, redacted to the viewer's tier. */
export interface VisibleBlock extends Activity {
  /** Minutes since local midnight, in the viewer's timezone. */
  start: number;
  end: number;
}

/**
 * A stretch of someone else's day when they aren't free, for their day or week calendar
 * (FR-VIEW-4, WF-065). Split at local midnight so each block belongs to one date.
 */
export interface ScheduleBlock extends VisibleBlock {
  id: string;
  date: string;
  status: 'busy' | 'dnd' | 'away';
  /** Away because it's outside their available hours (drawn as hatching, not a block). */
  outsideHours: boolean;
}

/** A connection's calendar for some dates, or why there's nothing to show. */
export interface ConnectionSchedule {
  state: 'ok' | 'paused' | 'no_schedule' | 'unavailable';
  blocks: ScheduleBlock[];
  /** The tier they show the viewer, already resolved (FR-VIS-3). */
  tier: Tier;
}

export interface FriendDetail {
  person: Connection;
  sharedGroups: GroupSummary[];
  /** The tier the viewer shows this friend, or null to use group settings. */
  viewerTierForThem: Tier | null;
  /** What applies without a friend-level tier: the most restrictive shared group (FR-VIS-3). */
  groupTier: { tier: Tier; groupName: string } | null;
  /** Upcoming times you're both free. Null until the slot finder lands (WF-098). */
  freeTogether: { date: string; start: number; end: number }[] | null;
}

export interface FriendRequest {
  /** The other person's user id: requests are keyed by the pair (WF-042). */
  id: string;
  person: Person;
  direction: 'incoming' | 'outgoing';
  sentAt: Iso;
}

/** How someone relates to the viewer (`get_profile`, `find_user_by_handle`, WF-040). */
export type Relationship = 'self' | 'friend' | 'request_sent' | 'request_received' | 'none';

/** Someone found by handle or friend link: their public profile only (FR-AUTH-2). */
export interface PublicPerson extends Person {
  relationship: Relationship;
}

export interface GroupMember extends Connection {
  role: 'admin' | 'member';
  permissions: GroupPermissions;
  isViewer: boolean;
}

export interface GroupInvite {
  id: string;
  code: string;
  url: string;
  expiresAt: Iso | null;
  maxUses: number | null;
  uses: number;
  /** The viewer made this link, so they may revoke or regenerate it (WF-045). */
  createdByMe: boolean;
}

export interface GroupDetail extends GroupSummary {
  members: GroupMember[];
  maxMembers: number;
  viewerPermissions: GroupPermissions;
  /** The tier the viewer shows this group (FR-VIS-2). */
  viewerTier: Tier;
  invite: GroupInvite | null;
}

/** Free/busy for the overlap views: times only, never why (FR-SLOT-3). */
export interface MemberBusyDay {
  personId: PersonId;
  /** Busy intervals in local minutes, including time outside available hours. */
  busy: [number, number][];
}

export interface OverlapWeek {
  weekStart: string;
  days: { date: string; members: MemberBusyDay[] }[];
  people: Person[];
  /** Left out of the maths: no schedule yet or sharing paused (FR-SLOT-4). */
  excluded: { person: Person; reason: 'no_schedule' | 'paused' }[];
}

export interface MyEvent {
  id: string;
  date: string;
  start: number;
  end: number;
  title: string;
  category: EventCategory;
  source: SourceType;
}

/**
 * A ping in the inbox (WF-092, WF-093), received or sent. Group pings (WF-096) aren't stored
 * yet; they will add the group here.
 */
export interface Ping {
  id: string;
  direction: 'received' | 'sent';
  /** The other person: who sent a received ping, or who a sent one went to. */
  other: Person;
  template?: PingTemplate;
  /** Plain text only, ≤ 140 characters (D31). Never rendered as HTML or linkified. */
  text?: string;
  sentAt: Iso;
  /** FR-PING-9: 2 hours after sending. Enforcing it on replies is WF-097. */
  expiresAt: Iso;
  /** The recipient's one reply (FR-PING-4): a quick reply or plain text. */
  reply?: { reply?: PingReply; text?: string; at: Iso };
  /** Received: the viewer hasn't read it. Sent: there's a reply the viewer hasn't read. */
  unread: boolean;
}

export interface Slot {
  date: string;
  start: number;
  end: number;
  free: Person[];
  missing: Person[];
}

export interface AvailableHoursDay {
  day: DayOfWeek;
  enabled: boolean;
  start: LocalTime;
  end: LocalTime;
}

export interface VisibilityRow {
  target: { type: 'friend'; person: Person } | { type: 'group'; group: GroupSummary };
  /** Tier set directly on this friend or group. Null for friends using group settings. */
  tier: Tier | null;
  /** Tier that actually applies (FR-VIS-3). */
  effectiveTier: Tier;
  /** FR-VIS-3a overlap hint, e.g. the group that lowered it. */
  loweredBy?: GroupSummary;
}

export interface ScheduleSource {
  /** The `sources` row id; missing for a source that isn't connected. */
  id?: string;
  type: SourceType;
  label: string;
  status: 'healthy' | 'failed' | 'needs_reconnect' | 'not_connected';
  detail: string;
  /** Last date an uploaded or typed-in schedule covers (FR-IMP-7), `YYYY-MM-DD`. */
  periodEnd?: string;
}

/** An offline friend an upload or schedule is for (WF-127, D44): only what the screens show. */
export interface OfflineFriendRef {
  id: string;
  nickname: string;
}

/** An unconfirmed upload (FR-IMP-16, WF-032), with its parse job if it has one. */
export interface PendingUpload {
  /** The schedule_files id. */
  id: string;
  fileName: string;
  uploadedAt: Iso;
  /** When it's deleted if never confirmed: 7 days after upload (D38). */
  deleteAt: Iso;
  /** null while the upload hasn't finished (no parse started). */
  jobId: string | null;
  jobStatus: ParseJobStatus | null;
  /** When the parse job last changed, to tell a stalled one (WF-131). */
  jobUpdatedAt: Iso | null;
  /** Why the parse failed (FR-IMP-14), when it did. A code; the UI words it. */
  error: ParseErrorCode | null;
  /** Set when it's an offline friend's timetable (WF-127). */
  offlineFriend: OfflineFriendRef | null;
}

export interface DraftEvent extends EventDraft {
  id: string;
}

export interface ParseJob {
  id: string;
  /** The uploaded file's name; empty for manual entry (WF-031). */
  fileName: string;
  status: ParseJobStatus;
  /** Why the parse failed, when `status` is failed (FR-IMP-14). */
  error?: ParseErrorCode | null;
  events: DraftEvent[];
  /** The dates the schedule covers, suggested by the parser or defaulted (FR-IMP-7). */
  period: { start: string; end: string; exceptions?: DateRange[] };
  /** Whether the parser found the dates in the file (FR-IMP-7), or they're a default to check. */
  periodFromFile?: boolean;
  /**
   * The original file, to compare against (FR-IMP-10): a same-origin URL that redirects to a
   * short-lived signed URL, its media type and page count.
   */
  original?: { url: string; mimeType: string; pages: number | null };
  /** Whose schedule this becomes: an offline friend's (WF-127), or the viewer's when null. */
  offlineFriend?: OfflineFriendRef | null;
}
