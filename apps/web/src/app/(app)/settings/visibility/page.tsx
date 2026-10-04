import type { Metadata } from 'next';
import { EyeOff } from 'lucide-react';
import { TIERS } from '@whosfree/shared';
import { TIER_DETAILS } from '@whosfree/ui/lib/tiers';
import { Panel } from '@/components/app/page-header';
import { SettingsPage } from '@/components/settings/settings-page';
import { VisibilityItem } from '@/components/settings/visibility-list';
import { getVisibilityOverview } from '@/lib/data/settings';

export const metadata: Metadata = { title: 'Who can see me' };

// "Who can see me" (FR-VIS-8, WF-048). Replaces the design's "Who can see event titles"
// (Everyone / Close friends / Nobody) with the PRD's per-friend and per-group tiers.
// TODO(WF-049): "How others see me" preview.
export default async function VisibilityPage() {
  const { friends, groups, members } = await getVisibilityOverview();
  return (
    <SettingsPage
      title="Who can see me"
      subtitle="Everyone starts at Free/Busy. A level you set for a friend always wins; otherwise the strictest shared group applies."
    >
      <Panel id="levels" title="The levels">
        <ul className="grid gap-2 sm:grid-cols-3">
          {TIERS.map((t) => (
            <li key={t} className="rounded-xl bg-background p-3">
              <p className="text-sm font-semibold">{TIER_DETAILS[t].title}</p>
              <p className="text-xs text-muted-foreground">“{TIER_DETAILS[t].example}”</p>
            </li>
          ))}
        </ul>
        <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
          <EyeOff aria-hidden="true" className="size-3.5" />
          Nobody ever sees where you are.
        </p>
      </Panel>
      <Panel id="groups" title="Groups">
        {groups.length ? null : (
          <p className="text-sm text-muted-foreground">You’re not in any groups yet.</p>
        )}
        <ul className="flex flex-col divide-y divide-border-subtle">
          {groups.map((row) => (
            <VisibilityItem
              key={row.target.type === 'group' ? row.target.group.id : ''}
              row={row}
              canSetOwn
            />
          ))}
        </ul>
      </Panel>
      <Panel id="friends" title="Friends">
        {friends.length ? null : <p className="text-sm text-muted-foreground">No friends yet.</p>}
        <ul className="flex flex-col divide-y divide-border-subtle">
          {friends.map((row) => (
            <VisibilityItem
              key={row.target.type === 'friend' ? row.target.person.id : ''}
              row={row}
              canSetOwn
            />
          ))}
        </ul>
      </Panel>
      {members.length ? (
        <Panel id="members" title="Group members who aren’t friends">
          <p className="text-xs text-muted-foreground">
            They see you at the strictest level of the groups you share.
          </p>
          <ul className="flex flex-col divide-y divide-border-subtle">
            {members.map((row) => (
              <VisibilityItem
                key={row.target.type === 'friend' ? row.target.person.id : ''}
                row={row}
                canSetOwn={false}
              />
            ))}
          </ul>
        </Panel>
      ) : null}
    </SettingsPage>
  );
}
