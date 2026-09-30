// ─────────────────────────────────────────────────────────────────────────────
// ALL MOCK DATA LIVES HERE. Nothing in this folder ships once the backend exists.
// TODO(WF-004, WF-041, WF-064): replace with Supabase queries via lib/data/*.
//
// Coverage on purpose: every tier (T1/T2/T3), every status including no_schedule
// and paused, stale sources, non-friend group members, an admin and a member view,
// a friend using group settings (overlap hint), and pings with/without replies.
// No locations anywhere (D35): titles are course codes and generic labels only.
// ─────────────────────────────────────────────────────────────────────────────

import {
  type EventCategory,
  type GroupPermissions,
  type ManualStatus,
  type PingReply,
  type PingTemplate,
  type SourceType,
  type Tier,
} from '@whosfree/shared';
import type { Person } from '@/lib/types';

export interface MockEvent {
  /** 0 = Monday … 6 = Sunday. */
  days: number[];
  start: number;
  end: number;
  category: EventCategory;
  title: string;
  source: SourceType;
}

export interface MockPerson extends Person {
  isFriend: boolean;
  /** The tier this person shows the viewer. */
  tierForViewer: Tier;
  /** The tier the viewer set for this friend; null = use group settings (FR-VIS-3). */
  viewerTier: Tier | null;
  /** Available hours in local minutes (D24 default 08:00–22:00). */
  hours: { start: number; end: number };
  weekly: MockEvent[];
  /** Replaces `weekly` on the mock "today" so the Now screen is the same any weekday. */
  today?: MockEvent[];
  /** Manual status for today, ending at `until` (local minutes). */
  override?: { status: ManualStatus; until: number };
  noSchedule?: boolean;
  paused?: boolean;
  stale?: boolean;
}

const D = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6 } as const;
const days = (s: string) => s.split(' ').map((d) => D[d as keyof typeof D]);
const t = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return h * 60 + m;
};
function ev(
  on: string,
  start: string,
  end: string,
  category: EventCategory,
  title: string,
  source: SourceType = 'upload',
): MockEvent {
  return { days: on ? days(on) : [], start: t(start), end: t(end), category, title, source };
}
const HOURS = { start: t('08:00'), end: t('22:00') };

export const VIEWER: MockPerson = {
  id: 'me',
  name: 'Kemar Brown',
  handle: 'kemar',
  hue: 285,
  isFriend: false,
  tierForViewer: 3,
  viewerTier: null,
  hours: HOURS,
  weekly: [
    ev('mon wed fri', '10:00', '12:00', 'class', 'COMP2140 Lecture'),
    ev('tue thu', '13:00', '14:00', 'tutorial', 'MATH1141 Tutorial'),
    ev('tue', '09:00', '12:00', 'lab', 'CHEM1901 Lab'),
    ev('wed', '15:00', '19:00', 'work', 'Part-time shift', 'manual'),
    ev('sat', '10:00', '16:00', 'work', 'Weekend shift', 'manual'),
    ev('mon thu', '17:00', '18:30', 'other', 'Football training', 'manual'),
    ev('thu', '09:00', '10:00', 'event', 'Dentist', 'gcal'),
    ev('sun', '09:00', '11:30', 'event', 'Church', 'gcal'),
  ],
  today: [
    ev('', '10:00', '12:00', 'class', 'COMP2140 Lecture'),
    ev('', '15:00', '19:00', 'work', 'Part-time shift', 'manual'),
    ev('', '20:00', '21:00', 'event', 'Call with Mummy', 'gcal'),
  ],
};

export const PEOPLE: MockPerson[] = [
  {
    id: 'shanice',
    name: 'Shanice Walker',
    handle: 'shanice',
    hue: 330,
    isFriend: true,
    tierForViewer: 1,
    viewerTier: 2,
    hours: HOURS,
    weekly: [
      ev('mon tue wed thu fri', '08:00', '12:00', 'work', 'Admin work'),
      ev('tue thu', '17:30', '19:00', 'other', 'Netball practice', 'manual'),
    ],
    today: [
      ev('', '08:00', '12:00', 'work', 'Admin work'),
      ev('', '16:30', '18:00', 'meeting', 'Netball committee'),
    ],
  },
  {
    id: 'tiamarie',
    name: 'Tia-Marie Campbell',
    handle: 'tiamarie',
    hue: 190,
    isFriend: true,
    tierForViewer: 2,
    viewerTier: 2,
    hours: HOURS,
    weekly: [
      ev('mon wed fri', '09:00', '11:00', 'class', 'SOCI1001 Lecture'),
      ev('tue thu', '14:00', '16:00', 'class', 'PSYC1002 Lecture'),
      ev('mon wed', '17:00', '19:00', 'work', 'Tutoring shift', 'manual'),
    ],
    today: [
      ev('', '09:00', '11:00', 'class', 'SOCI1001 Lecture'),
      ev('', '17:00', '19:00', 'work', 'Tutoring shift', 'manual'),
    ],
  },
  {
    id: 'omar',
    name: 'Omar Henry',
    handle: 'omarh',
    hue: 150,
    isFriend: true,
    tierForViewer: 2,
    viewerTier: 1,
    hours: HOURS,
    stale: true,
    weekly: [
      ev('mon wed', '11:00', '13:00', 'class', 'ACCT1005 Lecture'),
      ev('tue thu', '08:00', '10:00', 'class', 'ECON1001 Lecture'),
    ],
    today: [ev('', '11:00', '13:00', 'class', 'ACCT1005 Lecture')],
  },
  {
    id: 'aaliyah',
    name: 'Aaliyah Morgan',
    handle: 'aaliyah',
    hue: 20,
    isFriend: true,
    tierForViewer: 3,
    viewerTier: 3,
    hours: HOURS,
    weekly: [ev('mon tue wed thu fri', '09:00', '17:00', 'work', 'Work', 'gcal')],
    today: [
      ev('', '09:00', '13:00', 'work', 'Work', 'gcal'),
      ev('', '13:00', '16:00', 'meeting', 'Budget review', 'gcal'),
    ],
  },
  {
    id: 'andre',
    name: 'Andre Williams',
    handle: 'dre',
    hue: 100,
    isFriend: true,
    tierForViewer: 3,
    viewerTier: null,
    hours: HOURS,
    weekly: [
      ev('mon wed', '08:00', '10:00', 'tutorial', 'ECON1012 Tutorial'),
      ev('mon wed fri', '14:00', '16:00', 'class', 'ECON1000 Lecture'),
      ev('sat', '07:00', '12:00', 'work', 'Market stall', 'manual'),
    ],
    today: [
      ev('', '08:00', '10:00', 'tutorial', 'ECON1012 Tutorial'),
      ev('', '14:00', '16:00', 'class', 'ECON1000 Lecture'),
    ],
  },
  {
    id: 'jordan',
    name: 'Jordan Campbell',
    handle: 'jordanc',
    hue: 250,
    isFriend: true,
    tierForViewer: 2,
    viewerTier: 1,
    hours: { start: t('10:00'), end: t('23:00') },
    weekly: [
      ev('mon tue', '12:00', '20:00', 'work', 'Call centre shift'),
      ev('fri sat', '14:00', '22:00', 'work', 'Call centre shift'),
    ],
    today: [ev('', '12:00', '20:00', 'work', 'Call centre shift')],
  },
  {
    id: 'rushane',
    name: 'Rushane Thompson',
    handle: 'rushane',
    hue: 40,
    isFriend: false,
    tierForViewer: 1,
    viewerTier: null,
    hours: HOURS,
    weekly: [
      ev('mon wed', '13:00', '15:00', 'class', 'PHYS1411 Lecture'),
      ev('tue thu', '10:00', '12:00', 'lab', 'PHYS1412 Lab'),
    ],
    today: [ev('', '13:00', '15:00', 'class', 'PHYS1411 Lecture')],
  },
  {
    id: 'brianna',
    name: 'Brianna Scott',
    handle: 'bri',
    hue: 300,
    isFriend: true,
    tierForViewer: 3,
    viewerTier: 2,
    hours: HOURS,
    stale: true,
    weekly: [
      ev('wed', '12:00', '15:15', 'lab', 'BIOL1017 Lab'),
      ev('mon fri', '09:00', '11:00', 'class', 'BIOL1018 Lecture'),
    ],
    today: [ev('', '12:00', '15:15', 'lab', 'BIOL1017 Lab')],
  },
  {
    id: 'keisha',
    name: 'Keisha Grant',
    handle: 'keishag',
    hue: 0,
    isFriend: true,
    tierForViewer: 2,
    viewerTier: 1,
    hours: HOURS,
    override: { status: 'dnd', until: t('17:00') },
    weekly: [ev('mon tue wed thu', '09:00', '15:00', 'work', 'Teaching')],
  },
  {
    id: 'damion',
    name: 'Damion Clarke',
    handle: 'damion',
    hue: 210,
    isFriend: true,
    tierForViewer: 1,
    viewerTier: 1,
    hours: { start: t('17:00'), end: t('23:00') },
    weekly: [ev('fri sat', '18:00', '23:00', 'work', 'Bar shift', 'manual')],
  },
  {
    id: 'nadine',
    name: 'Nadine Reid',
    handle: 'nadine',
    hue: 60,
    isFriend: true,
    tierForViewer: 2,
    viewerTier: 1,
    hours: HOURS,
    noSchedule: true,
    weekly: [],
  },
  {
    id: 'chevaughn',
    name: 'Chevaughn Lewis',
    handle: 'chev',
    hue: 270,
    isFriend: true,
    tierForViewer: 1,
    viewerTier: 1,
    hours: HOURS,
    paused: true,
    weekly: [ev('mon tue wed thu fri', '08:00', '16:00', 'work', 'Work')],
  },
  {
    id: 'marcus',
    name: 'Marcus Bailey',
    handle: 'marcusb',
    hue: 175,
    isFriend: false,
    tierForViewer: 1,
    viewerTier: null,
    hours: HOURS,
    weekly: [ev('mon tue wed thu fri', '18:00', '21:00', 'work', 'Evening shift')],
  },
  {
    id: 'kadian',
    name: 'Kadian Ellis',
    handle: 'kadian',
    hue: 120,
    isFriend: false,
    tierForViewer: 1,
    viewerTier: null,
    hours: HOURS,
    weekly: [ev('mon tue wed thu fri', '09:00', '17:00', 'work', 'Work')],
  },
];

export interface MockGroup {
  id: string;
  name: string;
  emoji: string;
  adminId: string;
  memberIds: string[];
  maxMembers: number;
  /** The tier the viewer shows this group. */
  viewerTier: Tier;
  /** Per-member permissions that differ from the defaults (D26). */
  permissions?: Record<string, Partial<GroupPermissions>>;
  inviteCode: string | null;
}

export const GROUPS: MockGroup[] = [
  {
    id: 'flat-4',
    name: 'Flat 4',
    emoji: '🏠',
    adminId: 'aaliyah',
    memberIds: ['aaliyah', 'me', 'tiamarie', 'jordan', 'andre', 'brianna'],
    maxMembers: 20,
    viewerTier: 2,
    inviteCode: 'abc123',
  },
  {
    id: 'comp2140',
    name: 'COMP2140 Study',
    emoji: '📚',
    adminId: 'me',
    memberIds: ['me', 'andre', 'rushane', 'brianna', 'omar', 'nadine'],
    maxMembers: 20,
    viewerTier: 3,
    permissions: { andre: { manageMembers: true }, nadine: { groupPing: false } },
    inviteCode: 'st2140',
  },
  {
    id: 'netball',
    name: 'Netball Crew',
    emoji: '🏐',
    adminId: 'shanice',
    memberIds: ['shanice', 'me', 'keisha', 'marcus', 'tiamarie', 'chevaughn'],
    maxMembers: 20,
    viewerTier: 1,
    inviteCode: 'netbal',
  },
  {
    id: 'football',
    name: 'Sunday Football',
    emoji: '⚽',
    adminId: 'damion',
    memberIds: ['damion', 'me', 'rushane', 'jordan', 'kadian', 'omar'],
    maxMembers: 20,
    viewerTier: 1,
    permissions: { me: { manageMembers: true } },
    inviteCode: 'ballin',
  },
];

export interface MockPing {
  id: string;
  fromId: string;
  toId: string | { groupId: string };
  template?: PingTemplate;
  text?: string;
  /** Minutes before the mock now. */
  minutesAgo: number;
  replies?: { fromId: string; reply?: PingReply; text?: string; minutesAgo: number }[];
  read: boolean;
}

export const PINGS: MockPing[] = [
  {
    id: 'p1',
    fromId: 'shanice',
    toId: 'me',
    template: 'Free for food?',
    minutesAgo: 6,
    read: false,
  },
  {
    id: 'p2',
    fromId: 'andre',
    toId: 'me',
    template: 'Wanna study?',
    text: 'Bring the past papers, exam is Friday 😩',
    minutesAgo: 25,
    read: false,
  },
  {
    id: 'p3',
    fromId: 'tiamarie',
    toId: 'me',
    text: 'Yo check this flyer https://example.com/fete-flyer and tell me if you going',
    minutesAgo: 70,
    replies: [{ fromId: 'me', reply: "I'm down", minutesAgo: 60 }],
    read: true,
  },
  { id: 'p4', fromId: 'jordan', toId: 'me', template: 'Call me', minutesAgo: 190, read: true },
  {
    id: 's1',
    fromId: 'me',
    toId: 'omar',
    template: 'Free for food?',
    text: 'Patty run?',
    minutesAgo: 14,
    read: true,
  },
  {
    id: 's2',
    fromId: 'me',
    toId: { groupId: 'flat-4' },
    template: 'Link up?',
    minutesAgo: 45,
    replies: [
      { fromId: 'tiamarie', reply: 'In 10', minutesAgo: 40 },
      { fromId: 'aaliyah', reply: "Can't right now", minutesAgo: 38 },
    ],
    read: true,
  },
];
