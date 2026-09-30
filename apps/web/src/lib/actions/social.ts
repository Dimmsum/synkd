'use server';

// Friends, groups, invites and visibility (WF-042 to WF-050). Stubs only.

import { Tier, type GroupPermission } from '@whosfree/shared';
import { fail, mockDelay, ok, type ActionResult } from './result';

const validTier = (t: unknown) => Tier.safeParse(t).success;

export async function sendFriendRequest(handle: string): Promise<ActionResult> {
  const h = handle.trim().replace(/^@/, '');
  if (!/^[a-z0-9_.-]{2,30}$/i.test(h)) return fail('That doesn’t look like a handle.');
  // TODO(WF-042): send the request (rate-limited, NFR-SEC-9).
  await mockDelay();
  return ok;
}

export async function respondToFriendRequest(input: {
  requestId: string;
  accept: boolean;
  /** Required when accepting: what they'll see (FR-VIS-1, T1 preselected). */
  tier?: Tier;
}): Promise<ActionResult> {
  if (input.accept && !validTier(input.tier)) return fail('Pick what they can see.');
  // TODO(WF-042): accept_friend_request / decline, creating the visibilityRules row.
  await mockDelay();
  return ok;
}

export async function setFriendTier(_personId: string, tier: Tier | null): Promise<ActionResult> {
  if (tier !== null && !validTier(tier)) return fail('Unknown tier.');
  // TODO(WF-041, WF-048): upsert (or delete, for null) the friend visibilityRules row.
  await mockDelay();
  return ok;
}

export async function removeFriend(_personId: string): Promise<ActionResult> {
  // TODO(WF-047): revokes visibility straight away.
  await mockDelay();
  return ok;
}

export async function setGroupTier(_groupId: string, tier: Tier): Promise<ActionResult> {
  if (!validTier(tier)) return fail('Unknown tier.');
  // TODO(WF-041): update the group visibilityRules row.
  await mockDelay();
  return ok;
}

export async function createGroup(input: { name: string; emoji: string }): Promise<ActionResult> {
  const name = input.name.trim();
  if (name.length < 1 || name.length > 40)
    return fail('Give the group a name (up to 40 characters).');
  // TODO(WF-043): create_group; the creator becomes admin.
  await mockDelay();
  return ok;
}

export async function updateGroup(
  _groupId: string,
  input: { name: string; emoji: string },
): Promise<ActionResult> {
  if (!input.name.trim()) return fail('The group needs a name.');
  // TODO(WF-043): requires editGroup (checked on the server).
  await mockDelay();
  return ok;
}

export async function setMemberPermission(input: {
  groupId: string;
  personId: string;
  permission: GroupPermission;
  value: boolean;
}): Promise<ActionResult> {
  void input;
  // TODO(WF-044): admin only; every mutation re-checks permissions on the server.
  await mockDelay(200);
  return ok;
}

export async function removeMember(_groupId: string, _personId: string): Promise<ActionResult> {
  // TODO(WF-044): requires manageMembers.
  await mockDelay();
  return ok;
}

export async function transferAdmin(_groupId: string, _personId: string): Promise<ActionResult> {
  // TODO(WF-043, FR-SOC-7).
  await mockDelay();
  return ok;
}

export async function leaveGroup(_groupId: string): Promise<ActionResult> {
  // TODO(WF-047): admins must transfer first (FR-SOC-7).
  await mockDelay();
  return ok;
}

export async function deleteGroup(_groupId: string): Promise<ActionResult> {
  // TODO(WF-043): admin only.
  await mockDelay();
  return ok;
}

export async function regenerateInvite(_groupId: string): Promise<ActionResult> {
  // TODO(WF-045): revoke the old code and create a new one.
  await mockDelay();
  return ok;
}

export async function revokeInvite(_groupId: string): Promise<ActionResult> {
  // TODO(WF-045).
  await mockDelay();
  return ok;
}

export async function joinGroup(input: { code: string; tier: Tier }): Promise<ActionResult> {
  if (!validTier(input.tier)) return fail('Pick what the group can see.');
  // TODO(WF-045): join_group validates the invite, checks the cap and creates the member
  // row + visibility rule in one transaction.
  await mockDelay();
  return ok;
}
