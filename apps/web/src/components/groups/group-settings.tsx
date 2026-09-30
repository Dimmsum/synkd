'use client';

import { useState, useTransition } from 'react';
import {
  GROUP_PERMISSIONS,
  type GroupPermission,
  type GroupPermissions,
  type Tier,
} from '@whosfree/shared';
import { Copy, Crown, Link2Off, RefreshCw, Share2, UserMinus } from 'lucide-react';
import { Button } from '@whosfree/ui/components/button';
import { Input } from '@whosfree/ui/components/input';
import { Label } from '@whosfree/ui/components/label';
import { PersonAvatar } from '@whosfree/ui/components/person-avatar';
import { Switch } from '@whosfree/ui/components/switch';
import { TierPicker } from '@whosfree/ui/components/tier-picker';
import { cn } from '@whosfree/ui/lib/utils';
import { ActionButton } from '@/components/app/action-buttons';
import { GROUP_EMOJIS } from '@/components/groups/new-group-dialog';
import {
  deleteGroup,
  leaveGroup,
  regenerateInvite,
  removeMember,
  revokeInvite,
  setGroupTier,
  setMemberPermission,
  transferAdmin,
  updateGroup,
} from '@/lib/actions/social';
import type { GroupInvite } from '@/lib/types';

export const PERMISSION_LABELS: Record<GroupPermission, { label: string; hint: string }> = {
  invite: { label: 'Invite people', hint: 'Share the invite link' },
  manageMembers: { label: 'Manage members', hint: 'Remove people' },
  editGroup: { label: 'Edit group', hint: 'Change the name and emoji' },
  groupPing: { label: 'Ping the group', hint: 'Ping every free member at once' },
};

function SaveRow({
  onSave,
  pending,
  status,
}: {
  onSave: () => void;
  pending: boolean;
  status?: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <Button size="sm" onClick={onSave} disabled={pending}>
        Save
      </Button>
      <span role="status" className="text-sm text-muted-foreground">
        {status}
      </span>
    </div>
  );
}

/** What this group sees of the viewer (FR-VIS-2). Replaces the design's title toggle. */
export function GroupTierForm({
  groupId,
  groupName,
  initial,
}: {
  groupId: string;
  groupName: string;
  initial: Tier;
}) {
  const [tier, setTier] = useState<Tier>(initial);
  const [status, setStatus] = useState<string>();
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-4">
      <TierPicker value={tier} onValueChange={setTier} label={`What ${groupName} sees of you`} />
      <SaveRow
        pending={pending}
        status={status}
        onSave={() =>
          start(async () => {
            const res = await setGroupTier(groupId, tier);
            setStatus(res.ok ? 'Saved' : res.error);
          })
        }
      />
    </div>
  );
}

/** Invite link with copy and WhatsApp share (FR-SOC-3/4, WF-045/046). */
export function InviteLink({
  groupId,
  groupName,
  invite,
  canManage,
  full,
}: {
  groupId: string;
  groupName: string;
  invite: GroupInvite;
  canManage: boolean;
  full: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const text = `Join ${groupName} on Who's Free: ${invite.url}`;

  async function share() {
    // Web Share API first, then a wa.me link (FR-SOC-4).
    if (navigator.share) {
      try {
        await navigator.share({ title: `Join ${groupName}`, text, url: invite.url });
        return;
      } catch {
        // cancelled: fall through to nothing
        return;
      }
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[13px] text-muted-foreground">
        Anyone with the link can join. {full ? 'The group is full, so the link will say so.' : ''}
      </p>
      <div className="flex gap-2">
        <Input
          readOnly
          value={invite.url}
          aria-label="Invite link"
          className="font-mono text-[12.5px]"
          onFocus={(e) => e.currentTarget.select()}
        />
        <Button
          variant="outline"
          onClick={async () => {
            await navigator.clipboard.writeText(invite.url);
            setCopied(true);
          }}
        >
          <Copy aria-hidden="true" />
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <Button onClick={share} className="w-full sm:w-fit">
        <Share2 aria-hidden="true" />
        Share to WhatsApp
      </Button>
      <p className="text-xs text-muted-foreground">
        Used {invite.uses} {invite.uses === 1 ? 'time' : 'times'} ·{' '}
        {invite.expiresAt ? `expires ${invite.expiresAt}` : 'no expiry'} ·{' '}
        {invite.maxUses ? `max ${invite.maxUses} uses` : 'no use limit'}
      </p>
      {canManage ? (
        <div className="flex flex-wrap gap-2">
          <ActionButton
            action={() => regenerateInvite(groupId)}
            doneLabel="New link made"
            icon={<RefreshCw aria-hidden="true" />}
          >
            New link
          </ActionButton>
          <ActionButton
            action={() => revokeInvite(groupId)}
            doneLabel="Link turned off"
            icon={<Link2Off aria-hidden="true" />}
          >
            Turn off link
          </ActionButton>
        </div>
      ) : null}
    </div>
  );
}

export function GroupDetailsForm({
  groupId,
  name: initialName,
  emoji: initialEmoji,
}: {
  groupId: string;
  name: string;
  emoji: string;
}) {
  const [name, setName] = useState(initialName);
  const [emoji, setEmoji] = useState(initialEmoji);
  const [status, setStatus] = useState<string>();
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="edit-group-name">Name</Label>
        <Input
          id="edit-group-name"
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <fieldset>
        <legend className="mb-2 text-sm font-semibold">Emoji</legend>
        <div className="flex flex-wrap gap-2">
          {GROUP_EMOJIS.map((e) => (
            <button
              key={e}
              type="button"
              aria-pressed={emoji === e}
              aria-label={`Use ${e}`}
              onClick={() => setEmoji(e)}
              className={cn(
                'flex size-11 items-center justify-center rounded-xl border text-lg',
                emoji === e ? 'border-primary bg-primary-soft ring-2 ring-primary/40' : 'bg-card',
              )}
            >
              {e}
            </button>
          ))}
        </div>
      </fieldset>
      <SaveRow
        pending={pending}
        status={status}
        onSave={() =>
          start(async () => {
            const res = await updateGroup(groupId, { name, emoji });
            setStatus(res.ok ? 'Saved' : res.error);
          })
        }
      />
    </div>
  );
}

export interface MemberRowData {
  id: string;
  name: string;
  handle: string;
  hue: number;
  role: 'admin' | 'member';
  isViewer: boolean;
  permissions: GroupPermissions;
}

/**
 * Members with their permissions (FR-SOC-8). Only the admin can change permissions or
 * transfer the role; `manageMembers` lets others remove people. Being admin never shows
 * more of anyone's schedule (FR-SOC-10).
 */
export function MembersManager({
  groupId,
  members,
  viewerIsAdmin,
  viewerCanRemove,
}: {
  groupId: string;
  members: MemberRowData[];
  viewerIsAdmin: boolean;
  viewerCanRemove: boolean;
}) {
  const [perms, setPerms] = useState(() => new Map(members.map((m) => [m.id, m.permissions])));

  function toggle(id: string, p: GroupPermission, value: boolean) {
    setPerms((prev) => new Map(prev).set(id, { ...prev.get(id)!, [p]: value }));
    void setMemberPermission({ groupId, personId: id, permission: p, value });
  }

  return (
    <ul className="flex flex-col divide-y divide-border-subtle">
      {members.map((m) => {
        const mp = perms.get(m.id) ?? m.permissions;
        return (
          <li key={m.id} className="flex flex-col gap-3 py-3">
            <div className="flex items-center gap-3">
              <PersonAvatar name={m.name} hue={m.hue} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-semibold">
                  {m.name}
                  {m.isViewer ? ' (you)' : ''}
                </span>
                <span className="text-xs text-muted-foreground">@{m.handle}</span>
              </span>
              <span
                className={cn(
                  'rounded-full px-2.5 py-0.5 text-xs font-semibold',
                  m.role === 'admin'
                    ? 'bg-primary-soft text-primary-ink'
                    : 'bg-muted text-muted-foreground',
                )}
              >
                {m.role === 'admin' ? 'Admin' : 'Member'}
              </span>
            </div>
            {m.role === 'admin' ? (
              <p className="pl-12 text-xs text-muted-foreground">Admins have every permission.</p>
            ) : viewerIsAdmin ? (
              <fieldset className="grid gap-1 pl-12 sm:grid-cols-2">
                <legend className="sr-only">Permissions for {m.name}</legend>
                {GROUP_PERMISSIONS.map((p) => (
                  <label
                    key={p}
                    className="flex min-h-11 items-center justify-between gap-3 rounded-lg px-2 hover:bg-background"
                  >
                    <span className="flex flex-col">
                      <span className="text-[13px] font-medium">{PERMISSION_LABELS[p].label}</span>
                      <span className="text-[11px] text-muted-foreground">
                        {PERMISSION_LABELS[p].hint}
                      </span>
                    </span>
                    <Switch
                      checked={mp[p]}
                      onCheckedChange={(v) => toggle(m.id, p, v)}
                      aria-label={`${PERMISSION_LABELS[p].label} for ${m.name}`}
                    />
                  </label>
                ))}
              </fieldset>
            ) : (
              <p className="pl-12 text-xs text-muted-foreground">
                Can:{' '}
                {GROUP_PERMISSIONS.filter((p) => mp[p])
                  .map((p) => PERMISSION_LABELS[p].label.toLowerCase())
                  .join(', ') || 'nothing extra'}
              </p>
            )}
            {!m.isViewer && m.role !== 'admin' && (viewerIsAdmin || viewerCanRemove) ? (
              <div className="flex flex-wrap gap-2 pl-12">
                {viewerIsAdmin ? (
                  <ActionButton
                    action={() => transferAdmin(groupId, m.id)}
                    doneLabel="Admin transferred"
                    icon={<Crown aria-hidden="true" />}
                    ariaLabel={`Make ${m.name} the admin`}
                  >
                    Make admin
                  </ActionButton>
                ) : null}
                <ActionButton
                  action={() => removeMember(groupId, m.id)}
                  doneLabel="Removed"
                  icon={<UserMinus aria-hidden="true" />}
                  ariaLabel={`Remove ${m.name} from the group`}
                >
                  Remove
                </ActionButton>
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export function LeaveOrDelete({
  groupId,
  viewerIsAdmin,
}: {
  groupId: string;
  viewerIsAdmin: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      {viewerIsAdmin ? (
        <p className="text-sm text-muted-foreground">
          You&apos;re the admin. Make someone else admin before you leave, or delete the group.
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {viewerIsAdmin ? (
          <ActionButton
            action={() => deleteGroup(groupId)}
            doneLabel="Group deleted"
            variant="destructive"
          >
            Delete group
          </ActionButton>
        ) : (
          <ActionButton
            action={() => leaveGroup(groupId)}
            doneLabel="You left"
            variant="outline"
            className="text-destructive"
          >
            Leave group
          </ActionButton>
        )}
      </div>
    </div>
  );
}
