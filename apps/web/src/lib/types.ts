// View models the screens render. Data-access functions in `lib/data/` return these.
// They're shaped like what the server will send: other people's data arrives already
// redacted to the viewer's tier (FR-VIS-5), so screens never decide what to hide.

import type {
  DayOfWeek,
  EventCategory,
  EventDraft,
  GroupPermissions,
  LocalTime,
  ManualStatus,
  ParseJobStatus,
  PingReply,
  PingTemplate,
  SourceType,
  Status,
  Tier,
} from '@whosfree/shared';

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
  /** T3 only. */
  title?: string;
}

/** Someone the viewer can see: a friend, or a fellow group member (FR-SOC-5). */
export interface Connection extends Person {
  isFriend: boolean;
  /** The tier this person shows the viewer, already resolved (FR-VIS-3). */
  tier: Tier;
  status: Status;
  /** When the current status ends ("until X", D18). `null` for no_schedule and paused. */
  until: Iso | null;
  /** When they're next free, if they aren't free now. */
  nextFreeAt: Iso | null;
  /** Why they're busy, redacted to `tier`. */
  activity?: Activity;
  /** Show "Schedule may be out of date" (FR-VIEW-8, D25). */
  stale: boolean;
  groupIds: GroupId[];
}

export interface Viewer extends Person {
  timeZone: string;
  sharingPaused: boolean;
  status: Status;
  until: Iso | null;
  /** Manual status override, if set (J5). */
  manualStatus?: ManualStatus;
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

export interface DayTimeline {
  date: string;
  blocks: VisibleBlock[];
  /** Outside available hours (shown as Away). */
  hours: { start: number; end: number } | null;
}

export interface FriendDetail {
  person: Connection;
  timeline: DayTimeline[];
  sharedGroups: GroupSummary[];
  /** The tier the viewer shows this friend, or null to use group settings. */
  viewerTierForThem: Tier | null;
  /** What applies without a friend-level tier: the most restrictive shared group (FR-VIS-3). */
  groupTier: { tier: Tier; groupName: string } | null;
  /** Upcoming times you're both free. */
  freeTogether: { date: string; start: number; end: number }[];
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

export interface Ping {
  id: string;
  from: Person;
  to: Person | { group: GroupSummary };
  template?: PingTemplate;
  /** Plain text only, ≤ 140 characters (D31). Never rendered as HTML or linkified. */
  text?: string;
  sentAt: Iso;
  expiresAt: Iso;
  reply?: { from: Person; reply?: PingReply; text?: string; at: Iso }[];
  read: boolean;
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
  type: SourceType;
  label: string;
  status: 'healthy' | 'failed' | 'needs_reconnect' | 'not_connected';
  detail: string;
}

export interface PendingUpload {
  id: string;
  fileName: string;
  uploadedAt: Iso;
  deleteAt: Iso;
  jobId: string;
  jobStatus: ParseJobStatus;
  error?: string;
}

export interface DraftEvent extends EventDraft {
  id: string;
}

export interface ParseJob {
  id: string;
  fileName: string;
  status: ParseJobStatus;
  events: DraftEvent[];
  period: { start: string; end: string };
}
