'use server';

// Friends, groups, invites and visibility (WF-042 to WF-047). Each action calls one database
// function as the signed-in user; the database checks who may do what (permissions, blocks,
// the member cap) and rate-limits abusable writes (NFR-SEC-9, D41). The checks here only
// catch obvious input mistakes early.

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { after } from 'next/server';
import { DEFAULT_TIER, normalizeHandleInput, Tier, type GroupPermission } from '@whosfree/shared';
import type {
  FriendInvite,
  PublicProfile,
  RequestFriendByInviteResult,
  SendFriendRequestResult,
} from '@whosfree/backend';
import { appUrl } from '@/lib/config';
import { sendPushToUser } from '@/lib/push/send';
import { createServerSupabase, type ServerSupabase } from '@/lib/supabase/server';
import { isAlreadyMember, TRY_AGAIN } from '@/lib/social/errors';
import { INVITE_COOKIE, isInviteCode } from '@/lib/social/invite-cookie';
import {
  isUuid,
  toMyFriendInvite,
  toPublicPerson,
  type MyFriendInvite,
} from '@/lib/social/mappers';
import { friendAcceptedPushPayload, friendRequestPushPayload } from '@/lib/social/push';
import { failFrom, refreshSocial } from '@/lib/social/server';
import type { PublicPerson } from '@/lib/types';
import { fail, ok, type ActionResult } from './result';

const validTier = (t: unknown): t is Tier => Tier.safeParse(t).success;

const NOT_FOUND = 'We couldn’t find that person.';
const NO_GROUP = 'That group doesn’t exist, or you’re not in it any more.';

/** Something that could be a handle: 1–30 letters, digits or underscores after the `@`. */
function handleOrNull(input: string): string | null {
  const h = normalizeHandleInput(input);
  return /^[A-Za-z0-9_]{1,30}$/.test(h) ? h : null;
}

// ---------------------------------------------------------------------------
// Friends (WF-040, WF-042, WF-047)
// ---------------------------------------------------------------------------

/** A friend request notification stays useful for a day (WF-091 defaults to a ping's 2 hours). */
const FRIEND_PUSH_TTL_SECONDS = 24 * 60 * 60;

/**
 * Notifies `recipientId` that the signed-in user sent them a request (`pending`) or that they
 * are now friends (`accepted`), by Web Push after the response (WF-091). Only call it right after
 * a database function accepted that request as the signed-in user: Postgres has then checked
 * blocks and limits for this pair (D41). The title carries the user's own display name, read
 * from their own row under RLS, as a ping's does. Nothing is logged (NFR-SEC-11).
 */
async function notifyFriendRequest(
  supabase: ServerSupabase,
  recipientId: string,
  status: SendFriendRequestResult,
): Promise<void> {
  const { data } = await supabase.from('users').select('name').maybeSingle();
  const name = data?.name ?? '';
  const payload =
    status === 'accepted' ? friendAcceptedPushPayload(name) : friendRequestPushPayload(name);
  after(() => sendPushToUser(recipientId, payload, { ttlSeconds: FRIEND_PUSH_TTL_SECONDS }));
}

/**
 * Looks someone up by exact handle before sending a request (FR-AUTH-2, WF-040). Returns null
 * when nobody has that handle, or either of you blocked the other: the two look the same, so
 * a blocked user can't tell (FR-SOC-6). Rate-limited to 100 lookups an hour, so call it on
 * submit, not on every keystroke.
 */
export async function findPersonByHandle(
  handle: string,
): Promise<ActionResult<{ person: PublicPerson | null }>> {
  const h = handleOrNull(handle);
  if (!h) return fail('That doesn’t look like a handle.');
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc('find_user_by_handle', { lookup: h });
  if (error) return failFrom('find_user_by_handle', error);
  const row = (data as PublicProfile[])[0];
  return { ok: true, data: { person: row ? toPublicPerson(row) : null } };
}

/**
 * Sends a friend request by handle with the tier they'll see once they accept (FR-SOC-1,
 * FR-VIS-1: T1 by default). `accepted` means they had already asked you, so you're now
 * friends. Rate-limited: 20 a day, 3 a week to the same person (NFR-SEC-9).
 */
export async function sendFriendRequest(
  handle: string,
  tier: Tier = DEFAULT_TIER,
): Promise<ActionResult<{ status: SendFriendRequestResult }>> {
  const h = handleOrNull(handle);
  if (!h) return fail('That doesn’t look like a handle.');
  if (!validTier(tier)) return fail('Pick what they can see.');
  // By id, so the recipient can be notified (find_user_by_handle applies the same block rules).
  const found = await findPersonByHandle(h);
  if (!found.ok) return found;
  if (!found.data.person) return fail(NOT_FOUND);
  return sendFriendRequestTo(found.data.person.id, tier);
}

/** As `sendFriendRequest`, by user id: from a friend link or its QR code (WF-042). */
export async function sendFriendRequestTo(
  personId: string,
  tier: Tier = DEFAULT_TIER,
): Promise<ActionResult<{ status: SendFriendRequestResult }>> {
  if (!isUuid(personId)) return fail(NOT_FOUND);
  if (!validTier(tier)) return fail('Pick what they can see.');
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc('send_friend_request', { user_id: personId, tier });
  if (error) return failFrom('send_friend_request', error);
  const status = data as SendFriendRequestResult;
  await notifyFriendRequest(supabase, personId, status);
  refreshSocial();
  return { ok: true, data: { status } };
}

/**
 * Accepts or declines a request. `requestId` is the requester's user id (requests are keyed
 * by the pair). Accepting records the tier they'll see in the same transaction (FR-VIS-1).
 */
export async function respondToFriendRequest(input: {
  requestId: string;
  accept: boolean;
  /** Required when accepting: what they'll see (FR-VIS-1, T1 preselected). */
  tier?: Tier;
}): Promise<ActionResult> {
  if (input.accept && !validTier(input.tier)) return fail('Pick what they can see.');
  if (!isUuid(input.requestId)) return fail('That request isn’t there any more.');
  const supabase = await createServerSupabase();
  const { error } = input.accept
    ? await supabase.rpc('accept_friend_request', {
        user_id: input.requestId,
        tier: input.tier ?? DEFAULT_TIER,
      })
    : await supabase.rpc('decline_friend_request', { user_id: input.requestId });
  if (error)
    return failFrom(input.accept ? 'accept_friend_request' : 'decline_friend_request', error);
  // Accepting is only possible while they had asked and nobody is blocked (checked above).
  if (input.accept) await notifyFriendRequest(supabase, input.requestId, 'accepted');
  refreshSocial();
  return ok;
}

/**
 * Your friend invite link (WF-042, FR-SOC-1): a revocable /i/<code> link that lets anyone who
 * opens it, signed up already or not, send you a request with the tier they choose. Made on
 * request, then kept until you replace or turn it off. 10 new links a day (NFR-SEC-9).
 */
export async function createFriendInvite(): Promise<ActionResult<{ invite: MyFriendInvite }>> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc('create_friend_invite');
  if (error) return failFrom('create_friend_invite', error);
  revalidatePath('/friends');
  return { ok: true, data: { invite: toMyFriendInvite(data as FriendInvite, appUrl()) } };
}

/** Turns your friend invite link off and makes a new one (the old one stops working at once). */
export async function regenerateFriendInvite(): Promise<ActionResult<{ invite: MyFriendInvite }>> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc('regenerate_friend_invite');
  if (error) return failFrom('regenerate_friend_invite', error);
  revalidatePath('/friends');
  return { ok: true, data: { invite: toMyFriendInvite(data as FriendInvite, appUrl()) } };
}

/** Turns your friend invite link off. Your /add/<id> friend link and handle still work. */
export async function revokeFriendInvite(): Promise<ActionResult> {
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc('revoke_friend_invite');
  if (error) return failFrom('revoke_friend_invite', error);
  revalidatePath('/friends');
  return ok;
}

/**
 * Sends a friend request through someone's friend invite link (WF-042), with the tier they'll
 * see once they accept (FR-VIS-1, T1 preselected). `request_friend_by_invite` checks the link,
 * blocks and the friend request limits, and returns who to notify. `accepted` means they had
 * already asked you. Clears the remembered invite (WF-045 cookie) once it has worked.
 */
export async function requestFriendByInvite(input: {
  code: string;
  tier: Tier;
}): Promise<ActionResult<{ status: SendFriendRequestResult }>> {
  if (!validTier(input.tier)) return fail('Pick what they can see.');
  if (!isInviteCode(input.code)) return fail('That invite link doesn’t work.');
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc('request_friend_by_invite', {
    code: input.code,
    tier: input.tier,
  });
  if (error) return failFrom('request_friend_by_invite', error);
  const row = (data as RequestFriendByInviteResult[])[0];
  if (!row) {
    console.error('request_friend_by_invite returned no row');
    return fail(TRY_AGAIN);
  }
  await notifyFriendRequest(supabase, row.user_id, row.status);
  (await cookies()).delete(INVITE_COOKIE);
  refreshSocial();
  return { ok: true, data: { status: row.status } };
}

/** Withdraws a request you sent (idempotent). */
export async function cancelFriendRequest(personId: string): Promise<ActionResult> {
  if (!isUuid(personId)) return ok;
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc('cancel_friend_request', { user_id: personId });
  if (error) return failFrom('cancel_friend_request', error);
  refreshSocial();
  return ok;
}

/**
 * Changes the tier this friend sees of you (FR-VIS-2). Your own visibility rule is the one
 * thing clients may update directly, and RLS limits the update to your rows.
 */
export async function setFriendTier(personId: string, tier: Tier | null): Promise<ActionResult> {
  if (tier !== null && !validTier(tier)) return fail('Unknown tier.');
  // TODO(WF-048): falling back to group settings deletes the friend rule, which clients
  // can't do yet (it needs a small database function). Friends made by accepting a request
  // always have their own tier, so only this switch is affected.
  if (tier === null) return fail('For now, pick a level for them instead.');
  if (!isUuid(personId)) return fail(NOT_FOUND);
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from('visibility_rules')
    .update({ tier })
    .eq('target_type', 'friend')
    .eq('target_id', personId)
    .select('id');
  if (error) return failFrom('visibility_rules update', error);
  if (!data.length) return fail('You’re not friends any more.');
  refreshSocial();
  return ok;
}

/** Ends the friendship; visibility is revoked straight away (FR-SOC-6). Then back to Friends. */
export async function removeFriend(personId: string): Promise<ActionResult> {
  if (!isUuid(personId)) return fail(NOT_FOUND);
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc('unfriend', { user_id: personId });
  if (error) return failFrom('unfriend', error);
  refreshSocial();
  redirect('/friends');
}

/**
 * Blocks someone from their friend page, then goes back to Friends. They aren't told, the
 * friendship and any request end, and they can't find, ping or invite you (FR-SOC-6).
 */
export async function blockFriend(personId: string): Promise<ActionResult> {
  if (!isUuid(personId)) return fail(NOT_FOUND);
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc('block_user', { user_id: personId });
  if (error) return failFrom('block_user', error);
  refreshSocial();
  redirect('/friends');
}

// ---------------------------------------------------------------------------
// Groups (WF-043, WF-044, WF-047)
// ---------------------------------------------------------------------------

/** Changes the tier this group sees of you (FR-VIS-2); an update of your own rule under RLS. */
export async function setGroupTier(groupId: string, tier: Tier): Promise<ActionResult> {
  if (!validTier(tier)) return fail('Unknown tier.');
  if (!isUuid(groupId)) return fail(NO_GROUP);
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from('visibility_rules')
    .update({ tier })
    .eq('target_type', 'group')
    .eq('target_id', groupId)
    .select('id');
  if (error) return failFrom('visibility_rules update', error);
  if (!data.length) return fail(NO_GROUP);
  refreshSocial();
  return ok;
}

/**
 * Creates a group; the creator becomes its admin (FR-SOC-2, FR-SOC-7) and the group sees them
 * at T1 until they change it (FR-VIS-1). Capped at 20 members (FR-SOC-11); 10 new groups a day.
 */
export async function createGroup(input: {
  name: string;
  emoji: string;
}): Promise<ActionResult<{ groupId: string }>> {
  const name = input.name.trim();
  if (name.length < 1 || name.length > 40)
    return fail('Give the group a name (up to 40 characters).');
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc('create_group', { name, emoji: input.emoji });
  if (error) return failFrom('create_group', error);
  refreshSocial();
  return { ok: true, data: { groupId: data } };
}

/** Renames the group and sets its emoji. Needs `editGroup` (checked by the database). */
export async function updateGroup(
  groupId: string,
  input: { name: string; emoji: string },
): Promise<ActionResult> {
  if (!input.name.trim()) return fail('The group needs a name.');
  if (!isUuid(groupId)) return fail(NO_GROUP);
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc('update_group', {
    group_id: groupId,
    name: input.name.trim(),
    emoji: input.emoji,
  });
  if (error) return failFrom('update_group', error);
  refreshSocial();
  return ok;
}

const PERMISSION_ARG = {
  invite: 'can_invite',
  manageMembers: 'can_manage_members',
  editGroup: 'can_edit_group',
  groupPing: 'can_group_ping',
} as const satisfies Record<GroupPermission, string>;

/**
 * Grants or revokes one permission for one member (FR-SOC-8). Admin only, checked by the
 * database; taking `invite` away also turns off that member's invite links.
 */
export async function setMemberPermission(input: {
  groupId: string;
  personId: string;
  permission: GroupPermission;
  value: boolean;
}): Promise<ActionResult> {
  const arg = PERMISSION_ARG[input.permission];
  if (!arg || typeof input.value !== 'boolean') return fail('Unknown permission.');
  if (!isUuid(input.groupId) || !isUuid(input.personId)) return fail(NO_GROUP);
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc('set_group_member_permissions', {
    group_id: input.groupId,
    user_id: input.personId,
    [arg]: input.value,
  });
  if (error) return failFrom('set_group_member_permissions', error);
  refreshSocial();
  return ok;
}

/** Removes a member (never the admin). Needs `manageMembers` (FR-SOC-8). */
export async function removeMember(groupId: string, personId: string): Promise<ActionResult> {
  if (!isUuid(groupId) || !isUuid(personId)) return fail(NO_GROUP);
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc('remove_group_member', {
    group_id: groupId,
    user_id: personId,
  });
  if (error) return failFrom('remove_group_member', error);
  refreshSocial();
  return ok;
}

/** The admin hands the role to another member (FR-SOC-7) and becomes a member with D26 defaults. */
export async function transferAdmin(groupId: string, personId: string): Promise<ActionResult> {
  if (!isUuid(groupId) || !isUuid(personId)) return fail(NO_GROUP);
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc('transfer_group_admin', {
    group_id: groupId,
    new_admin_id: personId,
  });
  if (error) return failFrom('transfer_group_admin', error);
  refreshSocial();
  return ok;
}

/** Leaves the group (admins must transfer first, FR-SOC-7). Visibility ends at once. */
export async function leaveGroup(groupId: string): Promise<ActionResult> {
  if (!isUuid(groupId)) return fail(NO_GROUP);
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc('leave_group', { group_id: groupId });
  if (error) return failFrom('leave_group', error);
  refreshSocial();
  redirect('/groups');
}

/** Deletes the group with its memberships and invites. Admin only (FR-SOC-9). */
export async function deleteGroup(groupId: string): Promise<ActionResult> {
  if (!isUuid(groupId)) return fail(NO_GROUP);
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc('delete_group', { group_id: groupId });
  if (error) return failFrom('delete_group', error);
  refreshSocial();
  redirect('/groups');
}

// ---------------------------------------------------------------------------
// Invites and joining (WF-045)
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A new invite link, optionally expiring after some days and/or limited to a number of uses
 * (FR-SOC-3). Needs `invite`; 30 new links a day (NFR-SEC-9).
 */
export async function createInvite(
  groupId: string,
  limits: { expiresInDays: number | null; maxUses: number | null },
): Promise<ActionResult> {
  const { expiresInDays, maxUses } = limits;
  if (expiresInDays !== null && !(Number.isInteger(expiresInDays) && expiresInDays >= 1)) {
    return fail('Pick how long the link works.');
  }
  if (maxUses !== null && !(Number.isInteger(maxUses) && maxUses >= 1 && maxUses <= 1000)) {
    return fail('The use limit must be between 1 and 1000.');
  }
  if (!isUuid(groupId)) return fail(NO_GROUP);
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc('create_group_invite', {
    group_id: groupId,
    ...(expiresInDays !== null
      ? { expires_at: new Date(Date.now() + expiresInDays * DAY_MS).toISOString() }
      : {}),
    ...(maxUses !== null ? { max_uses: maxUses } : {}),
  });
  if (error) return failFrom('create_group_invite', error);
  refreshSocial();
  return ok;
}

/**
 * Turns the link off and makes a new one with the same limits. The admin, or the member who
 * made the link (checked by the database).
 */
export async function regenerateInvite(groupId: string, inviteId: string): Promise<ActionResult> {
  if (!isUuid(groupId) || !isUuid(inviteId)) return fail('That invite link doesn’t work.');
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc('regenerate_group_invite', { invite_id: inviteId });
  if (error) return failFrom('regenerate_group_invite', error);
  refreshSocial();
  return ok;
}

/** Turns the link off. The admin, or the member who made it. */
export async function revokeInvite(groupId: string, inviteId: string): Promise<ActionResult> {
  if (!isUuid(groupId) || !isUuid(inviteId)) return fail('That invite link doesn’t work.');
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc('revoke_group_invite', { invite_id: inviteId });
  if (error) return failFrom('revoke_group_invite', error);
  refreshSocial();
  return ok;
}

/**
 * Joins through an invite with the tier the group will see (FR-VIS-1). `join_group` validates
 * the invite, checks the cap and creates the member row and visibility rule in one
 * transaction (§8.5). Joining never makes anyone friends (FR-SOC-5). Being in the group
 * already counts as success, so a double tap or a second visit just opens the group. Clears
 * the remembered invite either way it succeeds.
 */
export async function joinGroup(input: {
  code: string;
  tier: Tier;
}): Promise<ActionResult<{ groupId: string }>> {
  if (!validTier(input.tier)) return fail('Pick what the group can see.');
  if (!isInviteCode(input.code)) return fail('That invite link doesn’t work.');
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc('join_group', { code: input.code, tier: input.tier });
  let groupId: string;
  if (!error) groupId = data;
  else if (isAlreadyMember(error) && error.details && isUuid(error.details))
    groupId = error.details;
  else return failFrom('join_group', error);
  (await cookies()).delete(INVITE_COOKIE);
  refreshSocial();
  return { ok: true, data: { groupId } };
}
