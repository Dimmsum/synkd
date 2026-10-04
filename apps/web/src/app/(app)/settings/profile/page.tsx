import type { Metadata } from 'next';
import { Panel } from '@/components/app/page-header';
import { AvatarEditor } from '@/components/settings/avatar-editor';
import { ProfileForm } from '@/components/settings/forms';
import { SettingsPage } from '@/components/settings/settings-page';
import { getProfile } from '@/lib/data/settings';

export const metadata: Metadata = { title: 'Profile' };

// Profile (FR-AUTH-2/3, WF-040).
// TODO(WF-050): pause sharing (FR-VIS-6, the PauseSharing switch) once setSharingPaused saves it.
// Unlike the design, no location is shown here (D35). The photo is the one taken from the
// sign-in provider at sign-up (users.avatar_url), one the user uploaded (the avatars bucket,
// lib/actions/avatar.ts), or initials.
export default async function ProfilePage() {
  const profile = await getProfile();
  return (
    <SettingsPage title="Profile" subtitle="How friends find you.">
      <Panel>
        <AvatarEditor
          name={profile.name}
          handle={profile.handle}
          hue={profile.hue}
          avatarUrl={profile.avatarUrl}
          photoFromGoogle={profile.photoFromGoogle}
        />
        <ProfileForm initial={profile} />
      </Panel>
    </SettingsPage>
  );
}
