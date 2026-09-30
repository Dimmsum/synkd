'use client';

import { useState, useTransition } from 'react';
import { BellRing, CirclePause } from 'lucide-react';
import { Button } from '@whosfree/ui/components/button';
import { Input } from '@whosfree/ui/components/input';
import { Label } from '@whosfree/ui/components/label';
import { Switch } from '@whosfree/ui/components/switch';
import { cn } from '@whosfree/ui/lib/utils';
import { saveNotificationSettings, saveProfile, setSharingPaused } from '@/lib/actions/settings';

const TIMEZONES = [
  'America/Jamaica',
  'America/New_York',
  'America/Toronto',
  'America/Port_of_Spain',
  'Europe/London',
];

function Status({ text }: { text?: string }) {
  return (
    <span
      role="status"
      className={cn('text-sm', text === 'Saved' ? 'text-status-free-ink' : 'text-destructive')}
    >
      {text}
    </span>
  );
}

export function ProfileForm({
  initial,
}: {
  initial: { name: string; handle: string; timeZone: string; email: string };
}) {
  const [name, setName] = useState(initial.name);
  const [handle, setHandle] = useState(initial.handle);
  const [timeZone, setTimeZone] = useState(initial.timeZone);
  const [status, setStatus] = useState<string>();
  const [pending, start] = useTransition();
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await saveProfile({ name, handle, timeZone });
          setStatus(res.ok ? 'Saved' : res.error);
        });
      }}
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="profile-name">Name</Label>
        <Input
          id="profile-name"
          value={name}
          autoComplete="name"
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="profile-handle">Handle</Label>
        <div className="relative">
          <span
            aria-hidden="true"
            className="absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
          >
            @
          </span>
          <Input
            id="profile-handle"
            value={handle}
            autoCapitalize="none"
            onChange={(e) => setHandle(e.target.value.replace(/^@/, ''))}
            className="pl-7"
            aria-describedby="handle-hint"
          />
        </div>
        <p id="handle-hint" className="text-xs text-muted-foreground">
          Friends can add you with this.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="profile-tz">Timezone</Label>
        <select
          id="profile-tz"
          value={timeZone}
          onChange={(e) => setTimeZone(e.target.value)}
          className="h-11 rounded-[10px] border border-input bg-card px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 md:h-10"
        >
          {TIMEZONES.map((tz) => (
            <option key={tz} value={tz}>
              {tz.replace('_', ' ')}
            </option>
          ))}
        </select>
      </div>
      <p className="text-xs text-muted-foreground">
        Signed in with Google as {initial.email}. Your photo comes from Google.
      </p>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={pending}>
          Save profile
        </Button>
        <Status text={status} />
      </div>
    </form>
  );
}

/** Pause sharing (FR-VIS-6): everyone sees "Sharing paused" until you resume. */
export function PauseSharing({ initial }: { initial: boolean }) {
  const [paused, setPaused] = useState(initial);
  const [, start] = useTransition();
  return (
    <label className="flex min-h-11 items-start justify-between gap-4">
      <span className="flex gap-3">
        <CirclePause aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
        <span className="flex flex-col">
          <span className="text-sm font-semibold">Pause sharing</span>
          <span className="text-xs text-muted-foreground">
            {paused
              ? 'Everyone sees “Sharing paused”. Turn this off to go back to your usual levels.'
              : 'Everyone will see “Sharing paused” instead of your status.'}
          </span>
        </span>
      </span>
      <Switch
        checked={paused}
        aria-label="Pause sharing"
        onCheckedChange={(v) => {
          setPaused(v);
          start(async () => {
            await setSharingPaused(v);
          });
        }}
      />
    </label>
  );
}

const TYPES = [
  { key: 'pings', label: 'Pings and replies' },
  { key: 'friendRequests', label: 'Friend requests' },
  { key: 'groupInvites', label: 'Group joins and invites' },
  {
    key: 'scheduleReminders',
    label: 'Schedule ending reminders',
    hint: '“Your schedule ends Dec 12. Upload the new one?”',
  },
] as const;

export function NotificationsForm({
  initial,
}: {
  initial: {
    types: Record<string, boolean>;
    quietHours: { enabled: boolean; start: string; end: string };
    pushEnabled: boolean;
  };
}) {
  const [types, setTypes] = useState(initial.types);
  const [quiet, setQuiet] = useState(initial.quietHours);
  const [status, setStatus] = useState<string>();
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-5">
      {!initial.pushEnabled ? (
        <div className="flex flex-col gap-3 rounded-xl bg-primary-soft p-4 sm:flex-row sm:items-center">
          <BellRing aria-hidden="true" className="size-5 shrink-0 text-primary-ink" />
          <p className="flex-1 text-sm text-body-foreground">
            Notifications are off on this device. Turn them on to hear about pings straight away. On
            iPhone, add Who&apos;s Free to your home screen first.
          </p>
          {/* TODO(WF-091): request permission only after this explanation (FR-PWA-4). */}
          <Button size="sm" onClick={() => setStatus('Coming soon: push notifications (WF-091)')}>
            Turn on
          </Button>
        </div>
      ) : null}
      <fieldset className="flex flex-col">
        <legend className="mb-1 text-sm font-semibold">Notify me about</legend>
        {TYPES.map((t) => (
          <label key={t.key} className="flex min-h-12 items-center justify-between gap-4 py-1">
            <span className="flex flex-col">
              <span className="text-sm">{t.label}</span>
              {'hint' in t ? <span className="text-xs text-muted-foreground">{t.hint}</span> : null}
            </span>
            <Switch
              checked={types[t.key] ?? false}
              onCheckedChange={(v) => setTypes({ ...types, [t.key]: v })}
              aria-label={t.label}
            />
          </label>
        ))}
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-semibold">Quiet hours</legend>
        <label className="flex min-h-11 items-center justify-between gap-4">
          <span className="text-sm">No ping notifications overnight</span>
          <Switch
            checked={quiet.enabled}
            onCheckedChange={(v) => setQuiet({ ...quiet, enabled: v })}
            aria-label="Quiet hours"
          />
        </label>
        {quiet.enabled ? (
          <div className="flex items-center gap-2">
            <Input
              type="time"
              value={quiet.start}
              onChange={(e) => setQuiet({ ...quiet, start: e.target.value })}
              aria-label="Quiet from"
              className="w-32 font-mono text-sm"
            />
            <span aria-hidden="true">–</span>
            <Input
              type="time"
              value={quiet.end}
              onChange={(e) => setQuiet({ ...quiet, end: e.target.value })}
              aria-label="Quiet until"
              className="w-32 font-mono text-sm"
            />
          </div>
        ) : null}
        <p className="text-xs text-muted-foreground">Pings still land in your inbox.</p>
      </fieldset>
      <div className="flex items-center gap-3">
        <Button
          size="sm"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await saveNotificationSettings({ types, quietHours: quiet });
              setStatus(res.ok ? 'Saved' : res.error);
            })
          }
        >
          Save
        </Button>
        <Status text={status} />
      </div>
    </div>
  );
}
