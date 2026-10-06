'use client';

// Turning Web Push on and off for this device (WF-091; FR-PWA-4, FR-PWA-3, NFR-COMPAT-2).
//
// FR-PWA-4: the browser's permission prompt only ever appears after the user has read what
// notifications are for and tapped "Turn on notifications". Nothing here prompts on load.
// Where push can't work (iPhone not installed, permission blocked, old iOS, unsupported
// browser, not configured), we say why and what to do, and remind people that pings always
// land in the in-app inbox (NFR-COMPAT-2; the inbox itself is WF-092).

import { useState, useTransition } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { Bell, BellOff, BellRing, Smartphone } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@synkd/ui/components/button';
import { cn } from '@synkd/ui/lib/utils';
import { sendTestPush } from '@/lib/actions/push';
import { disablePush, enablePush } from '@/lib/push/client';
import { IosInstallSteps, INSTALL_PAGE_HREF } from '@/components/pwa/install-prompt';
import { useInstallState } from '@/components/pwa/install-store';
import { usePushStatus } from './use-push-status';
import type { PushStatus } from './use-push-status';

/** The install guide (WF-111): Settings → Install app. */
export const INSTALL_GUIDE_HREF: Route = INSTALL_PAGE_HREF;

const linkClass = 'font-semibold text-primary-ink underline-offset-2 hover:underline';

const INBOX_NOTE = 'Pings always show up in your inbox too.';

interface Explanation {
  icon: LucideIcon;
  title: string;
  body: ReactNode;
}

function explain(status: Exclude<PushStatus, 'loading'>): Explanation {
  switch (status) {
    case 'off':
      return {
        icon: BellRing,
        title: 'Hear about pings straight away',
        body: 'Turn on notifications and we’ll tell you when a friend pings you or replies. We only notify you about pings, replies and requests, and you can pick which. Your browser will ask you to allow them next.',
      };
    case 'on':
      return {
        icon: Bell,
        title: 'Notifications are on',
        body: 'This device gets a notification when someone pings you.',
      };
    case 'denied':
      return {
        icon: BellOff,
        title: 'Notifications are blocked',
        body: 'Your browser is blocking notifications from synkd. To get them, allow notifications for this site in your browser or phone settings, then come back here.',
      };
    case 'ios-needs-install':
      return {
        icon: Smartphone,
        title: 'Add synkd to your Home Screen first',
        body: 'On iPhone and iPad, notifications only work in the installed app (iOS 16.4 or later). Add it to your Home Screen, open synkd from there and turn them on.',
      };
    case 'ios-too-old':
      return {
        icon: BellOff,
        title: 'Notifications need a newer iOS',
        body: 'Update your iPhone or iPad to iOS 16.4 or later to get notifications.',
      };
    case 'unsupported':
      return {
        icon: BellOff,
        title: 'This browser can’t show notifications',
        body: 'Try Chrome, Edge, Firefox or Safari, or install the app.',
      };
    case 'no-service-worker':
      return {
        icon: BellOff,
        title: 'We couldn’t set up notifications',
        body: 'Reload the page and try again. If it keeps happening, this browser may not support them.',
      };
    case 'not-configured':
      return {
        icon: BellOff,
        title: 'Notifications aren’t available yet',
        body: 'We’re still setting them up.',
      };
  }
}

/**
 * The explanation screen and the on/off switch for push on this device. Put it wherever
 * notifications are offered: Settings → Notifications and the onboarding install step. On an
 * iPhone or iPad that hasn't installed the app it shows the "Add to Home Screen" steps (WF-111),
 * unless `iosSteps` is off because the page shows the install guide already.
 */
export function PushPermission({
  className,
  iosSteps = true,
}: {
  className?: string;
  iosSteps?: boolean;
}) {
  const { status, setStatus } = usePushStatus({ resync: true });
  const install = useInstallState();
  const [message, setMessage] = useState<string>();
  const [pending, start] = useTransition();

  if (status === 'loading') {
    // Same size as the card, so the page doesn't jump once the browser has been checked.
    return <div aria-hidden="true" className={cn('min-h-28 rounded-xl bg-muted/40', className)} />;
  }

  const { icon: Icon, title, body } = explain(status);

  const turnOn = () =>
    start(async () => {
      setMessage(undefined);
      const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!vapidKey) return setStatus('not-configured');
      const res = await enablePush(vapidKey);
      if (res.ok) return setStatus('on');
      if (res.reason === 'denied') return setStatus('denied');
      if (res.reason === 'no-service-worker') return setStatus('no-service-worker');
      if (res.reason === 'dismissed') {
        return setMessage('No problem. You can turn them on here any time.');
      }
      setMessage(res.error ?? 'Something went wrong. Try again.');
    });

  const turnOff = () =>
    start(async () => {
      setMessage(undefined);
      await disablePush();
      setStatus('off');
    });

  const test = () =>
    start(async () => {
      const res = await sendTestPush();
      setMessage(res.ok ? 'Sent. It should arrive in a few seconds.' : res.error);
    });

  return (
    <section
      aria-labelledby="push-permission-title"
      className={cn(
        'flex flex-col gap-3 rounded-xl p-4 sm:flex-row sm:items-start',
        status === 'on' ? 'border bg-card' : 'bg-primary-soft',
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-5 shrink-0 text-primary-ink" />
      <div className="flex flex-1 flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="push-permission-title" className="text-sm font-semibold">
            {title}
          </h2>
          <p className="text-sm text-body-foreground">{body}</p>
          {status !== 'on' ? <p className="text-xs text-muted-foreground">{INBOX_NOTE}</p> : null}
        </div>
        {status === 'ios-needs-install' && iosSteps ? (
          install?.platform === 'ios-in-app' ? (
            // An app's built-in browser can't install: the guide starts with opening Safari.
            <p className="text-sm">
              <Link href={INSTALL_GUIDE_HREF} className={linkClass}>
                How to install
              </Link>
            </p>
          ) : (
            <IosInstallSteps browser={install?.platform === 'ios-browser' ? 'other' : 'safari'} />
          )
        ) : null}
        {status === 'off' ? (
          <div>
            <Button size="sm" disabled={pending} onClick={turnOn}>
              {pending ? 'Turning on…' : 'Turn on notifications'}
            </Button>
          </div>
        ) : null}
        {status === 'on' ? (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={pending} onClick={test}>
              Send a test
            </Button>
            <Button size="sm" variant="ghost" disabled={pending} onClick={turnOff}>
              Turn off on this device
            </Button>
          </div>
        ) : null}
        <p role="status" className="text-sm text-body-foreground empty:hidden">
          {message}
        </p>
      </div>
    </section>
  );
}

/**
 * The inbox's reminder (NFR-COMPAT-2): the inbox is where pings land for anyone without push.
 * Shows nothing once push is on for this device.
 */
export function PushInboxHint() {
  const { status } = usePushStatus();
  if (status === 'loading' || status === 'on') return null;

  let text: ReactNode;
  if (status === 'off' || status === 'no-service-worker') {
    text = (
      <>
        <Link href="/settings/notifications" className={linkClass}>
          Turn on notifications
        </Link>{' '}
        to hear about pings straight away. They’ll always show up here too.
      </>
    );
  } else if (status === 'ios-needs-install') {
    text = (
      <>
        <Link href={INSTALL_GUIDE_HREF} className={linkClass}>
          Add synkd to your Home Screen
        </Link>{' '}
        to get notifications. Until then, pings show up here.
      </>
    );
  } else {
    text = 'Notifications are off on this device, so pings show up here.';
  }

  return (
    <p className="flex items-start gap-2 rounded-xl border bg-card p-3 text-[13px] text-body-foreground">
      <BellRing aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary-ink" />
      <span>{text}</span>
    </p>
  );
}
