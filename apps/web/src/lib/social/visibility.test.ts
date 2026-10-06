import { describe, expect, it } from 'vitest';
import type { Friend, GroupMember, MyGroup } from '@synkd/backend';
import { toVisibilityOverview } from './visibility';

const ME = '00000000-0000-4000-8000-000000000000';
const ALICE = '11111111-1111-4111-8111-111111111111';
const BEN = '22222222-2222-4222-8222-222222222222';
const CARA = '44444444-4444-4444-8444-444444444444';
const FLAT = '33333333-3333-4333-8333-333333333333';
const CLUB = '55555555-5555-4555-8555-555555555555';

const group = (id: string, name: string, my_tier: 1 | 2 | 3): MyGroup => ({
  id,
  name,
  emoji: null,
  role: 'member',
  member_count: 3,
  max_members: 20,
  my_tier,
  can_invite: true,
  can_manage_members: false,
  can_edit_group: false,
  can_group_ping: true,
  joined_at: '2026-09-01T12:00:00Z',
});

const friend = (user_id: string, name: string, tier: 1 | 2 | 3 | null): Friend => ({
  user_id,
  name,
  handle: name.toLowerCase(),
  avatar_url: null,
  tier,
});

const member = (user_id: string, name: string, is_me = false): GroupMember => ({
  user_id,
  name,
  handle: name.toLowerCase(),
  avatar_url: null,
  role: 'member',
  can_invite: true,
  can_manage_members: false,
  can_edit_group: false,
  can_group_ping: true,
  joined_at: '2026-09-01T12:00:00Z',
  is_me,
});

describe('toVisibilityOverview (FR-VIS-8, WF-134: real rows, never the mock)', () => {
  it('is empty for a new user with no friends or groups', () => {
    expect(toVisibilityOverview([], [], [])).toEqual({ friends: [], groups: [], members: [] });
  });

  it('lists only the viewer’s own friends and groups', () => {
    const o = toVisibilityOverview(
      [friend(ALICE, 'Alice', null)],
      [group(FLAT, 'Flat 4', 2)],
      [{ groupId: FLAT, members: [member(ME, 'Me', true)] }],
    );
    expect(o.friends.map((r) => r.target.type === 'friend' && r.target.person.name)).toEqual([
      'Alice',
    ]);
    expect(o.groups).toEqual([
      expect.objectContaining({
        target: expect.objectContaining({ type: 'group' }),
        tier: 2,
        effectiveTier: 2,
      }),
    ]);
    expect(o.members).toEqual([]);
  });

  it('a tier set on a friend always wins over shared groups (FR-VIS-3)', () => {
    const o = toVisibilityOverview(
      [friend(ALICE, 'Alice', 3)],
      [group(FLAT, 'Flat 4', 1)],
      [{ groupId: FLAT, members: [member(ALICE, 'Alice')] }],
    );
    expect(o.friends[0]).toMatchObject({ tier: 3, effectiveTier: 3 });
    expect(o.friends[0]?.loweredBy).toBeUndefined();
  });

  it('without one, the strictest shared group applies and is named when it lowers (FR-VIS-3a)', () => {
    const o = toVisibilityOverview(
      [friend(ALICE, 'Alice', null), friend(BEN, 'Ben', null)],
      [group(FLAT, 'Flat 4', 3), group(CLUB, 'Club', 2)],
      [
        { groupId: FLAT, members: [member(ALICE, 'Alice')] },
        { groupId: CLUB, members: [member(ALICE, 'Alice')] },
      ],
    );
    expect(o.friends[0]).toMatchObject({
      tier: null,
      effectiveTier: 2,
      loweredBy: expect.objectContaining({ id: CLUB, name: 'Club' }),
    });
    // Ben shares no group: the default.
    expect(o.friends[1]).toMatchObject({ tier: null, effectiveTier: 1 });
    expect(o.friends[1]?.loweredBy).toBeUndefined();
  });

  it('lists group members who aren’t friends once, at their strictest shared group', () => {
    const o = toVisibilityOverview(
      [friend(ALICE, 'Alice', null)],
      [group(FLAT, 'Flat 4', 3), group(CLUB, 'Club', 2)],
      [
        {
          groupId: FLAT,
          members: [member(ME, 'Me', true), member(ALICE, 'Alice'), member(CARA, 'Cara')],
        },
        { groupId: CLUB, members: [member(CARA, 'Cara')] },
      ],
    );
    expect(o.members).toHaveLength(1);
    expect(o.members[0]).toMatchObject({
      target: { type: 'friend', person: expect.objectContaining({ id: CARA }) },
      tier: null,
      effectiveTier: 2,
    });
  });
});
