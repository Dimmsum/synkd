import { describe, expect, it } from 'vitest';
import type {
  Friend,
  FriendRequest,
  GroupInvite,
  GroupMember,
  MyGroup,
  PublicProfile,
} from '@whosfree/backend';
import { hueFor } from '@/lib/hue';
import {
  DEFAULT_GROUP_EMOJI,
  friendLinkUrl,
  friendToPerson,
  groupsByMember,
  inviteUrl,
  isUuid,
  mostRestrictiveGroup,
  pickInvite,
  toConnection,
  toFriendInvitePreview,
  toFriendInviteSummary,
  toFriendRequest,
  toGroupInvite,
  toGroupMember,
  toGroupSummary,
  toInviteSummary,
  toMyFriendInvite,
  toPermissions,
  toPerson,
  toPublicPerson,
  withPresence,
} from './mappers';

const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';
const GROUP = '33333333-3333-4333-8333-333333333333';
const APP = 'https://whosfree.app';
const CODE = 'AbCdEfGhIjKlMnOpQr_-12';

const group = (over: Partial<MyGroup> = {}): MyGroup => ({
  id: GROUP,
  name: 'Flat 4',
  emoji: '🏠',
  role: 'member',
  member_count: 5,
  max_members: 20,
  my_tier: 2,
  can_invite: true,
  can_manage_members: false,
  can_edit_group: false,
  can_group_ping: true,
  joined_at: '2026-09-01T12:00:00Z',
  ...over,
});

const invite = (over: Partial<GroupInvite> = {}): GroupInvite => ({
  id: ID_A,
  code: CODE,
  expires_at: null,
  max_uses: null,
  uses: 3,
  created_at: '2026-09-01T12:00:00Z',
  created_by_me: false,
  ...over,
});

describe('people', () => {
  it('toPerson: a missing handle becomes empty, the hue comes from the id', () => {
    expect(toPerson({ id: ID_A, name: 'Kemar Brown', handle: null })).toEqual({
      id: ID_A,
      name: 'Kemar Brown',
      handle: '',
      hue: hueFor(ID_A),
    });
  });

  it('toPublicPerson keeps the relationship and drops the avatar (WF-040)', () => {
    const row: PublicProfile = {
      id: ID_A,
      name: 'Kemar',
      handle: 'kemar',
      avatar_url: 'https://img/x',
      relationship: 'request_received',
    };
    expect(toPublicPerson(row)).toEqual({
      id: ID_A,
      name: 'Kemar',
      handle: 'kemar',
      hue: hueFor(ID_A),
      relationship: 'request_received',
    });
  });

  it('friendToPerson reads list_friends rows', () => {
    const row: Friend = {
      user_id: ID_B,
      name: 'Shanice',
      handle: 'shan',
      avatar_url: null,
      tier: 3,
    };
    expect(friendToPerson(row)).toMatchObject({ id: ID_B, name: 'Shanice', handle: 'shan' });
  });

  it('toConnection has no status yet and the minimum tier', () => {
    const c = toConnection(toPerson({ id: ID_A, name: 'K', handle: 'k' }), {
      isFriend: true,
      groupIds: [GROUP],
    });
    expect(c).toMatchObject({
      isFriend: true,
      groupIds: [GROUP],
      tier: 1,
      status: 'no_schedule',
      until: null,
      nextFreeAt: null,
      stale: false,
    });
    expect(c.activity).toBeUndefined();
  });

  it('withPresence takes status and resolved tier from the Now data (WF-064)', () => {
    const base = toConnection(toPerson({ id: ID_A, name: 'K', handle: 'k' }), {
      isFriend: true,
      groupIds: [GROUP],
    });
    const fromNow = {
      ...base,
      name: 'Someone else',
      isFriend: false,
      groupIds: [],
      tier: 3 as const,
      status: 'busy' as const,
      until: '2026-09-30T20:00:00.000Z',
      nextFreeAt: '2026-09-30T20:00:00.000Z',
      activity: { title: 'COMP2140 Lecture' },
      upcoming: [],
      refreshAt: null,
    };
    expect(withPresence(base, fromNow)).toEqual({
      ...base,
      tier: 3,
      status: 'busy',
      until: '2026-09-30T20:00:00.000Z',
      nextFreeAt: '2026-09-30T20:00:00.000Z',
      activity: { title: 'COMP2140 Lecture' },
      upcoming: [],
      refreshAt: null,
    });
  });

  it('withPresence leaves the connection alone without a Now row for them', () => {
    const base = toConnection(toPerson({ id: ID_A, name: 'K', handle: 'k' }), {
      isFriend: true,
      groupIds: [GROUP],
    });
    expect(withPresence(base, undefined)).toBe(base);
    expect(withPresence(base, { ...base, id: ID_B, status: 'free' })).toBe(base);
  });
});

describe('toFriendRequest (WF-042)', () => {
  it('keys the request by the other person’s id', () => {
    const row: FriendRequest = {
      user_id: ID_B,
      name: 'Alicia',
      handle: null,
      avatar_url: null,
      direction: 'incoming',
      tier: null,
      requested_at: '2026-09-30T10:00:00Z',
    };
    expect(toFriendRequest(row)).toEqual({
      id: ID_B,
      person: { id: ID_B, name: 'Alicia', handle: '', hue: hueFor(ID_B) },
      direction: 'incoming',
      sentAt: '2026-09-30T10:00:00Z',
    });
  });
});

describe('groups (WF-043/044)', () => {
  it('toGroupSummary maps the row and defaults a missing emoji', () => {
    expect(toGroupSummary(group({ role: 'admin' }))).toEqual({
      id: GROUP,
      name: 'Flat 4',
      emoji: '🏠',
      memberCount: 5,
      freeNowCount: 0,
      viewerRole: 'admin',
    });
    expect(toGroupSummary(group({ emoji: null })).emoji).toBe(DEFAULT_GROUP_EMOJI);
  });

  it('toPermissions names the four permissions (FR-SOC-8)', () => {
    expect(toPermissions(group())).toEqual({
      invite: true,
      manageMembers: false,
      editGroup: false,
      groupPing: true,
    });
  });

  it('toGroupMember carries role, permissions and "is me", but no schedule (FR-SOC-10)', () => {
    const row: GroupMember = {
      user_id: ID_B,
      name: 'Tia',
      handle: 'tia',
      avatar_url: null,
      role: 'admin',
      can_invite: true,
      can_manage_members: true,
      can_edit_group: true,
      can_group_ping: true,
      joined_at: '2026-09-01T12:00:00Z',
      is_me: false,
    };
    const m = toGroupMember(row, { isFriend: false, groupIds: [GROUP] });
    expect(m).toMatchObject({
      id: ID_B,
      role: 'admin',
      isViewer: false,
      isFriend: false,
      tier: 1,
      status: 'no_schedule',
      permissions: { invite: true, manageMembers: true, editGroup: true, groupPing: true },
    });
    expect(m.activity).toBeUndefined();
  });

  it('mostRestrictiveGroup picks the lowest tier among shared groups (FR-VIS-3)', () => {
    expect(mostRestrictiveGroup([])).toBeNull();
    expect(
      mostRestrictiveGroup([
        { name: 'Netball', my_tier: 3 },
        { name: 'Flat 4', my_tier: 1 },
        { name: 'Study', my_tier: 2 },
      ]),
    ).toEqual({ tier: 1, groupName: 'Flat 4' });
  });

  it('groupsByMember indexes members across groups', () => {
    const index = groupsByMember([
      { groupId: 'g1', memberIds: [ID_A, ID_B] },
      { groupId: 'g2', memberIds: [ID_B] },
    ]);
    expect(index.get(ID_A)).toEqual(['g1']);
    expect(index.get(ID_B)).toEqual(['g1', 'g2']);
    expect(index.get('nobody')).toBeUndefined();
  });
});

describe('invites (WF-045)', () => {
  it('builds invite and friend links on the app origin', () => {
    expect(inviteUrl(CODE, APP)).toBe(`${APP}/i/${CODE}`);
    expect(inviteUrl(CODE, `${APP}/`)).toBe(`${APP}/i/${CODE}`);
    expect(friendLinkUrl(ID_A, APP)).toBe(`${APP}/add/${ID_A}`);
  });

  it('toGroupInvite maps limits and ownership', () => {
    const row = invite({ expires_at: '2026-10-07T00:00:00Z', max_uses: 10, created_by_me: true });
    expect(toGroupInvite(row, APP)).toEqual({
      id: ID_A,
      code: CODE,
      url: `${APP}/i/${CODE}`,
      expiresAt: '2026-10-07T00:00:00Z',
      maxUses: 10,
      uses: 3,
      createdByMe: true,
    });
  });

  it('pickInvite prefers the viewer’s own newest link, else the newest', () => {
    const theirs = invite({ id: 'a' });
    const mine = invite({ id: 'b', created_by_me: true });
    expect(pickInvite([])).toBeNull();
    expect(pickInvite([theirs, mine])?.id).toBe('b');
    expect(pickInvite([theirs, invite({ id: 'c' })])?.id).toBe('a');
  });

  it('toInviteSummary maps the database statuses (FR-WEB-3)', () => {
    expect(
      toInviteSummary(CODE, {
        status: 'valid',
        inviter_name: 'Aaliyah',
        group_name: 'Flat 4',
        group_emoji: null,
        member_count: 4,
      }),
    ).toEqual({
      state: 'ok',
      code: CODE,
      inviterName: 'Aaliyah',
      groupName: 'Flat 4',
      emoji: DEFAULT_GROUP_EMOJI,
      memberCount: 4,
    });
    expect(
      toInviteSummary(CODE, {
        status: 'full',
        inviter_name: 'Aaliyah',
        group_name: 'Flat 4',
        group_emoji: '🏠',
        member_count: 20,
      }).state,
    ).toBe('full');
    for (const status of ['expired', 'used_up', 'revoked'] as const) {
      expect(
        toInviteSummary(CODE, {
          status,
          inviter_name: null,
          group_name: null,
          group_emoji: null,
          member_count: null,
        }),
      ).toEqual({ state: 'invalid', code: CODE, reason: status });
    }
    expect(toInviteSummary(CODE, undefined)).toEqual({
      state: 'invalid',
      code: CODE,
      reason: 'not_found',
    });
  });
});

describe('friend invites (WF-042)', () => {
  it('toFriendInviteSummary shows only the inviter’s name while the link works', () => {
    expect(toFriendInviteSummary(CODE, { status: 'valid', inviter_name: 'Aaliyah' })).toEqual({
      state: 'ok',
      code: CODE,
      inviterName: 'Aaliyah',
    });
    expect(toFriendInviteSummary(CODE, { status: 'revoked', inviter_name: null })).toEqual({
      state: 'invalid',
      code: CODE,
      reason: 'revoked',
    });
    expect(toFriendInviteSummary(CODE, undefined)).toEqual({
      state: 'invalid',
      code: CODE,
      reason: 'not_found',
    });
  });

  it('toFriendInvitePreview maps the inviter to a public person', () => {
    expect(
      toFriendInvitePreview(CODE, {
        status: 'valid',
        user_id: ID_A,
        name: 'Aaliyah',
        handle: null,
        avatar_url: 'https://example.com/a.webp',
        relationship: 'none',
      }),
    ).toEqual({
      state: 'ok',
      code: CODE,
      person: { id: ID_A, name: 'Aaliyah', handle: '', hue: hueFor(ID_A), relationship: 'none' },
    });
    expect(
      toFriendInvitePreview(CODE, {
        status: 'revoked',
        user_id: null,
        name: null,
        handle: null,
        avatar_url: null,
        relationship: null,
      }),
    ).toEqual({ state: 'invalid', code: CODE, reason: 'revoked' });
    expect(toFriendInvitePreview(CODE, undefined).state).toBe('invalid');
  });

  it('toMyFriendInvite builds the /i/ link', () => {
    expect(
      toMyFriendInvite({ id: ID_A, code: CODE, uses: 2, created_at: '2026-10-01T00:00:00Z' }, APP),
    ).toEqual({ code: CODE, url: `${APP}/i/${CODE}`, uses: 2 });
  });
});

describe('isUuid', () => {
  it('accepts uuids only', () => {
    expect(isUuid(ID_A)).toBe(true);
    expect(isUuid('kevaughn')).toBe(false);
    expect(isUuid(`${ID_A}x`)).toBe(false);
  });
});
