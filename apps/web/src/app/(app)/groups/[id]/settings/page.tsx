import type { Metadata, Route } from 'next';
import { notFound } from 'next/navigation';
import { PageHeader, Panel } from '@/components/app/page-header';
import {
  GroupDetailsForm,
  GroupTierForm,
  InviteLink,
  LeaveOrDelete,
  MembersManager,
} from '@/components/groups/group-settings';
import { getGroup } from '@/lib/data/people';

export const metadata: Metadata = { title: 'Group settings' };

// Group settings (WF-043/044/045): tier, invite link, details, members and permissions.
// Every mutation is re-checked on the server (TODO in lib/actions/social.ts).
export default async function GroupSettingsPage({ params }: PageProps<'/groups/[id]/settings'>) {
  const { id } = await params;
  const group = await getGroup(id);
  if (!group) notFound();
  const isAdmin = group.viewerRole === 'admin';
  const perms = group.viewerPermissions;

  return (
    <>
      <PageHeader
        title="Group settings"
        subtitle={`${group.emoji} ${group.name} · ${group.memberCount} of ${group.maxMembers} members`}
        back={{ href: `/groups/${id}` as Route, label: group.name }}
      />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2 lg:items-start">
        <div className="flex flex-col gap-4">
          <Panel id="tier" title="What this group sees of you">
            <GroupTierForm groupId={id} groupName={group.name} initial={group.viewerTier} />
          </Panel>
          {perms.invite && group.invite ? (
            <Panel id="invite" title="Invite link">
              <InviteLink
                groupId={id}
                groupName={group.name}
                invite={group.invite}
                canManage={isAdmin}
                full={group.memberCount >= group.maxMembers}
              />
            </Panel>
          ) : null}
          {perms.editGroup ? (
            <Panel id="details" title="Name and emoji">
              <GroupDetailsForm groupId={id} name={group.name} emoji={group.emoji} />
            </Panel>
          ) : null}
        </div>
        <div className="flex flex-col gap-4">
          <Panel
            id="members"
            title={`Members · ${group.memberCount} of ${group.maxMembers}`}
            bodyClassName="pb-2"
          >
            <p className="mb-1 text-xs text-muted-foreground">
              Admins don&apos;t see more of anyone&apos;s schedule. Everyone sees each member at the
              level that member picked.
            </p>
            <MembersManager
              groupId={id}
              viewerIsAdmin={isAdmin}
              viewerCanRemove={perms.manageMembers}
              members={group.members.map((m) => ({
                id: m.id,
                name: m.name,
                handle: m.handle,
                hue: m.hue,
                role: m.role,
                isViewer: m.isViewer,
                permissions: m.permissions,
              }))}
            />
          </Panel>
          <Panel id="leave" title={isAdmin ? 'Delete group' : 'Leave group'}>
            <LeaveOrDelete groupId={id} viewerIsAdmin={isAdmin} />
          </Panel>
        </div>
      </div>
    </>
  );
}
