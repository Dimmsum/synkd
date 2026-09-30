import type { Metadata } from 'next';
import { PersonAvatar } from '@whosfree/ui/components/person-avatar';
import { Panel } from '@/components/app/page-header';
import { PauseSharing, ProfileForm } from '@/components/settings/forms';
import { SettingsPage } from '@/components/settings/settings-page';
import { getProfile } from '@/lib/data/settings';

export const metadata: Metadata = { title: 'Profile' };

// Profile (FR-AUTH-2/3, WF-040) and pause sharing (FR-VIS-6, WF-050).
// Unlike the design, no location is shown here (D35).
export default async function ProfilePage() {
  const profile = await getProfile();
  return (
    <SettingsPage title="Profile" subtitle="How friends find you.">
      <Panel>
        <div className="mb-5 flex items-center gap-4">
          <PersonAvatar name={profile.name} hue={profile.hue} size="xl" />
          <div>
            <p className="text-lg font-bold">{profile.name}</p>
            <p className="text-sm text-muted-foreground">@{profile.handle}</p>
          </div>
        </div>
        <ProfileForm initial={profile} />
      </Panel>
      <Panel>
        <PauseSharing initial={profile.sharingPaused} />
      </Panel>
    </SettingsPage>
  );
}
