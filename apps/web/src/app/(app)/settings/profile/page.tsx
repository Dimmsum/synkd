import type { Metadata } from 'next';
import { Avatar, AvatarFallback, AvatarImage } from '@whosfree/ui/components/avatar';
import { initialsOf, personColor } from '@whosfree/ui/components/person-avatar';
import { Panel } from '@/components/app/page-header';
import { PauseSharing, ProfileForm } from '@/components/settings/forms';
import { SettingsPage } from '@/components/settings/settings-page';
import { getProfile } from '@/lib/data/settings';

export const metadata: Metadata = { title: 'Profile' };

// Profile (FR-AUTH-2/3, WF-040) and pause sharing (FR-VIS-6, WF-050).
// Unlike the design, no location is shown here (D35).
// TODO(WF-040): replacing the photo needs an avatars bucket in Supabase Storage, which doesn't
// exist yet; until then the photo is the one taken from the sign-in provider at sign-up
// (users.avatar_url), or initials.
export default async function ProfilePage() {
  const profile = await getProfile();
  return (
    <SettingsPage title="Profile" subtitle="How friends find you.">
      <Panel>
        <div className="mb-5 flex items-center gap-4">
          {/* Decorative: the name is right next to it. */}
          <Avatar aria-hidden="true" className="size-18">
            {profile.avatarUrl ? (
              <AvatarImage src={profile.avatarUrl} alt="" referrerPolicy="no-referrer" />
            ) : null}
            <AvatarFallback
              className="text-xl font-bold text-white"
              style={{ background: personColor(profile.hue) }}
            >
              {initialsOf(profile.name)}
            </AvatarFallback>
          </Avatar>
          <div>
            <p className="text-lg font-bold">{profile.name}</p>
            {profile.handle ? (
              <p className="text-sm text-muted-foreground">@{profile.handle}</p>
            ) : (
              <p className="text-sm text-muted-foreground">No handle yet</p>
            )}
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
