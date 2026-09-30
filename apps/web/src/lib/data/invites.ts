import { GROUPS, OTHER_INVITES } from '@/lib/mock/data';
import { findPerson } from '@/lib/mock/selectors';

export type InviteSummary =
  | {
      state: 'ok' | 'full';
      code: string;
      inviterName: string;
      groupName: string;
      emoji: string;
      memberCount: number;
      maxMembers: number;
    }
  | { state: 'invalid'; code: string };

/**
 * What a signed-out visitor may see about an invite (FR-WEB-3): the inviter's name, the
 * group's name and emoji, and the member count. Never anyone's schedule.
 * TODO(WF-045): resolve the code on the server (not expired, not revoked, uses left).
 */
export async function getInvite(code: string): Promise<InviteSummary> {
  const g = GROUPS.find((x) => x.inviteCode === code);
  if (g) {
    return {
      state: g.memberIds.length >= g.maxMembers ? 'full' : 'ok',
      code,
      inviterName: findPerson(g.adminId)?.name ?? 'A friend',
      groupName: g.name,
      emoji: g.emoji,
      memberCount: g.memberIds.length,
      maxMembers: g.maxMembers,
    };
  }
  const other = OTHER_INVITES[code];
  if (other) {
    return {
      state: other.memberCount >= other.maxMembers ? 'full' : 'ok',
      code,
      ...other,
    };
  }
  return { state: 'invalid', code };
}
