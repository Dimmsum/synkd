// Social reads as the signed-in user (WF-042, WF-043, WF-045). Each wraps one security definer
// function, which applies blocks both ways (FR-SOC-6, D43) and never returns schedules (D41).
// Memoised per request with React's `cache`, since the layout, the page and its metadata
// often ask for the same list.
//
// Only error codes go into thrown errors and logs, never names or handles (NFR-SEC-11).

import 'server-only';
import { cache } from 'react';
import type {
  Friend,
  FriendRequest,
  GroupInvite,
  GroupMember,
  MyGroup,
  PublicProfile,
} from '@synkd/backend';
import { createServerSupabase } from '@/lib/supabase/server';
import { groupsByMember, isUuid } from '@/lib/social/mappers';

function failed(fn: string, code: string | undefined): Error {
  return new Error(`${fn} failed (${code ?? 'no code'})`);
}

/** The viewer's groups with role, permissions and chosen tier (`list_my_groups`). */
export const listMyGroups = cache(async (): Promise<MyGroup[]> => {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc('list_my_groups');
  if (error) throw failed('list_my_groups', error.code);
  return data as MyGroup[];
});

/** The viewer's friends and the tier the viewer grants each (`list_friends`). */
export const listFriends = cache(async (): Promise<Friend[]> => {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc('list_friends');
  if (error) throw failed('list_friends', error.code);
  return data as Friend[];
});

/** Pending requests both ways, newest first (`list_friend_requests`). */
export const listFriendRequests = cache(async (): Promise<FriendRequest[]> => {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc('list_friend_requests');
  if (error) throw failed('list_friend_requests', error.code);
  return data as FriendRequest[];
});

/**
 * A group's members (`get_group_members`), or null when the viewer isn't in it (the database
 * says "Group not found" whether or not it exists).
 */
export const listGroupMembers = cache(async (groupId: string): Promise<GroupMember[] | null> => {
  if (!isUuid(groupId)) return null;
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc('get_group_members', { group_id: groupId });
  if (error?.code === 'P0002') return null;
  if (error) throw failed('get_group_members', error.code);
  return data as GroupMember[];
});

/** The group's live invite links, newest first. Only for members allowed to invite. */
export const listGroupInvites = cache(async (groupId: string): Promise<GroupInvite[]> => {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc('list_group_invites', { group_id: groupId });
  // Not allowed (42501) or no longer a member (P0002): there's simply no link to show.
  if (error?.code === '42501' || error?.code === 'P0002') return [];
  if (error) throw failed('list_group_invites', error.code);
  return data as GroupInvite[];
});

/** user id → the viewer's groups that person is in (for "shared groups", FR-SOC-5). */
export const groupMembershipIndex = cache(async (): Promise<Map<string, string[]>> => {
  const groups = await listMyGroups();
  const lists = await Promise.all(
    groups.map(async (g) => ({
      groupId: g.id,
      memberIds: ((await listGroupMembers(g.id)) ?? []).map((m) => m.user_id),
    })),
  );
  return groupsByMember(lists);
});

/** Another user's public profile by id (`get_profile`); null if missing or blocked either way. */
export const getProfile = cache(async (userId: string): Promise<PublicProfile | null> => {
  if (!isUuid(userId)) return null;
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc('get_profile', { user_id: userId });
  if (error) throw failed('get_profile', error.code);
  return ((data as PublicProfile[])[0] ?? null) as PublicProfile | null;
});
