'use client';

// Install prompt and iOS "Add to Home Screen" guide (WF-111; FR-PWA-3, R5, J1.8).
// lib/install.ts decides what to show; components/pwa/install-store.ts holds the captured
// `beforeinstallprompt` event and the dismissal.

import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Route } from 'next';
import {
  Bell,
  CircleCheck,
  Compass,
  Download,
  Ellipsis,
  EllipsisVertical,
  ExternalLink,
  MonitorDown,
  Plus,
  Share,
  Smartphone,
  SquarePlus,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@whosfree/ui/components/button';
import { cn } from '@whosfree/ui/lib/utils';
import { installView, type InstallSurface, type InstallView } from '@/lib/install';
import {
  dismissInstall,
  promptInstall,
  showInstallAgain,
  useInstallState,
  type InstallState,
} from './install-store';

/** Settings → Install app: where a dismissed prompt can always be found again. */
export const INSTALL_PAGE_HREF = '/settings/install' as Route;

const PUSH_NEEDS_INSTALL =
  'On iPhone and iPad, notifications only work once Who’s Free is on your Home Screen (iOS 16.4 or later).';

interface Step {
  icon: LucideIcon;
  text: ReactNode;
}

function Steps({ steps, label }: { steps: Step[]; label: string }) {
  return (
    <ol aria-label={label} className="flex flex-col gap-2.5">
      {steps.map(({ icon: Icon, text }, i) => (
        <li key={i} className="flex items-start gap-3 text-sm text-body-foreground">
          <span
            aria-hidden="true"
            className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary-soft font-mono text-xs font-medium text-primary-ink"
          >
            {i + 1}
          </span>
          <span className="flex-1 pt-0.5">{text}</span>
          <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        </li>
      ))}
    </ol>
  );
}

/**
 * Step-by-step "Add to Home Screen" for iPhone and iPad (FR-PWA-3). `browser` is Safari or
 * another iOS browser (Chrome, Edge, Firefox), whose Share button sits elsewhere.
 */
export function IosInstallSteps({ browser = 'safari' }: { browser?: 'safari' | 'other' }) {
  return (
    <Steps
      label="Add to Home Screen steps"
      steps={[
        {
          icon: Share,
          text:
            browser === 'safari' ? (
              <>
                Tap the <strong className="text-foreground">Share</strong> button in Safari’s
                toolbar. On newer iPhones it’s in the{' '}
                <strong className="text-foreground">•••</strong> menu.
              </>
            ) : (
              <>
                Tap the <strong className="text-foreground">Share</strong> button. In Chrome and
                Edge it’s in the address bar, in Firefox it’s in the menu.
              </>
            ),
        },
        {
          icon: SquarePlus,
          text: (
            <>
              Scroll down and tap <strong className="text-foreground">Add to Home Screen</strong>.
            </>
          ),
        },
        {
          icon: Plus,
          text: (
            <>
              Tap <strong className="text-foreground">Add</strong>.
            </>
          ),
        },
        {
          icon: Bell,
          text: 'Open Who’s Free from your Home Screen and turn on notifications.',
        },
      ]}
    />
  );
}

function InAppSteps() {
  return (
    <Steps
      label="Open in Safari steps"
      steps={[
        {
          icon: Ellipsis,
          text: (
            <>
              Tap the <strong className="text-foreground">•••</strong> menu or the{' '}
              <strong className="text-foreground">compass</strong>, usually in a corner.
            </>
          ),
        },
        {
          icon: Compass,
          text: (
            <>
              Choose <strong className="text-foreground">Open in Safari</strong> (or Open in
              browser).
            </>
          ),
        },
        { icon: SquarePlus, text: 'Then add Who’s Free to your Home Screen from Safari.' },
      ]}
    />
  );
}

interface Content {
  icon: LucideIcon;
  title: string;
  body: ReactNode;
  steps?: ReactNode;
}

function content(view: InstallView, state: InstallState): Content | null {
  switch (view) {
    case 'prompt':
      return {
        icon: Download,
        title: 'Install Who’s Free',
        body: 'Open it from your home screen like any other app, and get pings as notifications. It takes a second and uses almost no space.',
      };
    case 'ios-safari':
      return {
        icon: Smartphone,
        title: 'Add Who’s Free to your Home Screen',
        body: state.iosPush
          ? PUSH_NEEDS_INSTALL
          : 'You can open it from your Home Screen like an app. Notifications need iOS 16.4 or later, so update your iPhone to get them.',
        steps: <IosInstallSteps browser="safari" />,
      };
    case 'ios-browser':
      return state.iosPush
        ? {
            icon: Smartphone,
            title: 'Add Who’s Free to your Home Screen',
            body: (
              <>
                {PUSH_NEEDS_INSTALL} If you don’t see Add to Home Screen, open this page in Safari.
              </>
            ),
            steps: <IosInstallSteps browser="other" />,
          }
        : {
            icon: Compass,
            title: 'Open Who’s Free in Safari to install it',
            body: 'On this version of iOS, only Safari can add apps to your Home Screen.',
            steps: <IosInstallSteps browser="safari" />,
          };
    case 'ios-in-app':
      return {
        icon: ExternalLink,
        title: 'Open Who’s Free in Safari to install it',
        body: `This app’s built-in browser can’t add Who’s Free to your Home Screen. ${PUSH_NEEDS_INSTALL}`,
        steps: <InAppSteps />,
      };
    case 'android-menu':
      return {
        icon: Download,
        title: 'Install Who’s Free',
        body: 'Open it from your home screen like any other app, and get pings as notifications.',
        steps: (
          <Steps
            label="Install steps"
            steps={[
              {
                icon: EllipsisVertical,
                text: (
                  <>
                    Open your browser’s menu <strong className="text-foreground">⋮</strong>.
                  </>
                ),
              },
              {
                icon: SquarePlus,
                text: (
                  <>
                    Tap <strong className="text-foreground">Install app</strong> or{' '}
                    <strong className="text-foreground">Add to Home screen</strong>.
                  </>
                ),
              },
            ]}
          />
        ),
      };
    case 'desktop':
      return {
        icon: MonitorDown,
        title: 'Install Who’s Free on your phone',
        body: 'It works best on your phone, where pings arrive as notifications. Open this site on your phone and follow the steps there. In Chrome or Edge on a computer, you can also install it from the install button in the address bar.',
      };
    case 'installed':
      return {
        icon: CircleCheck,
        title: 'Who’s Free is installed',
        body: 'You’re using the installed app on this device.',
      };
    case 'hidden':
    case 'collapsed':
      return null;
  }
}

/**
 * The install card: our own prompt where the browser offers one (Android, Chromium), the
 * step-by-step guide on iPhone and iPad, nothing once installed. `surface` says where it is
 * (see lib/install.ts): in onboarding it can be dismissed, and in Settings and on the help
 * page it always shows, because the user asked for it.
 */
export function InstallPrompt({
  surface,
  className,
}: {
  surface: Exclude<InstallSurface, 'banner'>;
  className?: string;
}) {
  const state = useInstallState();
  const titleId = useId();
  const [message, setMessage] = useState<string>();
  const [pending, setPending] = useState(false);

  if (!state) {
    // Same size as the card, so the page doesn't jump once the browser has been checked.
    return <div aria-hidden="true" className={cn('min-h-28 rounded-2xl bg-muted/40', className)} />;
  }

  const view = installView({ ...state, surface });
  if (view === 'collapsed') {
    return (
      <Button variant="outline" size="lg" onClick={showInstallAgain} className={className}>
        <Smartphone aria-hidden="true" />
        Show me how to install
      </Button>
    );
  }
  const shown = content(view, state);
  if (!shown) return null;
  const { icon: Icon, title, body, steps } = shown;

  const install = async () => {
    setPending(true);
    setMessage(undefined);
    const outcome = await promptInstall().finally(() => setPending(false));
    if (outcome === 'dismissed')
      setMessage('No problem. You can install it from Settings any time.');
  };

  return (
    <section
      aria-labelledby={titleId}
      className={cn(
        'flex flex-col gap-4 rounded-2xl border p-5',
        view === 'installed' ? 'bg-card' : 'bg-primary-soft/60',
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-card text-primary-ink">
          <Icon aria-hidden="true" className="size-5" />
        </span>
        <div className="flex flex-1 flex-col gap-1">
          <h2 id={titleId} className="font-semibold">
            {title}
          </h2>
          <p className="text-sm text-body-foreground">{body}</p>
        </div>
      </div>
      {steps}
      {view === 'prompt' || surface === 'onboarding' ? (
        <div className="flex flex-wrap gap-2">
          {view === 'prompt' ? (
            <Button disabled={pending} onClick={install}>
              <Download aria-hidden="true" />
              Install
            </Button>
          ) : null}
          {surface === 'onboarding' && view !== 'installed' ? (
            <Button variant="ghost" onClick={dismissInstall}>
              Not now
            </Button>
          ) : null}
        </div>
      ) : null}
      <p role="status" className="text-sm text-body-foreground empty:hidden">
        {message}
      </p>
    </section>
  );
}

/**
 * The app shell's install nudge on phones and tablets (FR-PWA-3): one line, an Install button
 * (Android) or a link to the guide (iPhone/iPad), and a close button. Gone for good on this
 * device once closed, until the user opens Settings → Install app.
 */
export function InstallBanner() {
  const state = useInstallState();
  const pathname = usePathname();
  if (!state || pathname === INSTALL_PAGE_HREF) return null;
  const view = installView({ ...state, surface: 'banner' });
  if (view === 'hidden') return null;

  return (
    <aside
      aria-label="Install Who’s Free"
      className="mb-4 flex items-center gap-3 rounded-xl border bg-card py-2 pr-1.5 pl-3"
    >
      <Smartphone aria-hidden="true" className="size-5 shrink-0 text-primary-ink" />
      <p className="flex-1 text-sm text-body-foreground">
        {view === 'prompt'
          ? 'Install Who’s Free to get pings as notifications.'
          : 'Add Who’s Free to your Home Screen to get pings as notifications.'}
      </p>
      {view === 'prompt' ? (
        <Button size="sm" onClick={() => void promptInstall()}>
          Install
        </Button>
      ) : (
        <Link
          href={INSTALL_PAGE_HREF}
          className="inline-flex min-h-11 items-center rounded-md px-2 text-sm font-semibold text-primary-ink underline-offset-2 hover:underline"
        >
          Show me how
        </Link>
      )}
      <Button variant="ghost" size="icon-sm" aria-label="Dismiss" onClick={dismissInstall}>
        <X aria-hidden="true" />
      </Button>
    </aside>
  );
}
