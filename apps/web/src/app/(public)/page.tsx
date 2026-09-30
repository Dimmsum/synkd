import Link from 'next/link';
import {
  ArrowRight,
  CalendarDays,
  EyeOff,
  FileText,
  MapPinOff,
  Send,
  ShieldCheck,
  Smartphone,
  Trash,
  UsersRound,
} from 'lucide-react';
import { buttonVariants } from '@whosfree/ui/components/button';
import { StatusBadge } from '@whosfree/ui/components/status-badge';
import { PersonAvatar } from '@whosfree/ui/components/person-avatar';
import { Eyebrow } from '@whosfree/ui/components/misc';
import { cn } from '@whosfree/ui/lib/utils';
import { SiteFooter, SiteHeader } from '@/components/public/site-chrome';

// Landing page (FR-WEB-1, WF-009). Fully static with no client JavaScript, so it stays well
// inside the LCP budget on Fast 3G (NFR-PERF-1).
// TODO(WF-004): redirect signed-in users to /now (in proxy.ts, once Clerk is wired).
export const dynamic = 'force-static';

const STEPS = [
  {
    icon: FileText,
    title: 'Add your schedule',
    body: 'Upload your timetable or roster as a PDF, photo or screenshot, or connect Google Calendar. Check it over and you’re done in a few minutes.',
  },
  {
    icon: UsersRound,
    title: 'Choose who sees what',
    body: 'Add friends and join groups. For each one, pick how much they see: just free/busy, what kind of thing you’re doing, or the details.',
  },
  {
    icon: Send,
    title: 'Link up',
    body: 'See who’s free right now and until when. Ping them in one tap, or find a time that works for the whole group.',
  },
] as const;

const PROMISES = [
  {
    icon: ShieldCheck,
    title: 'You choose who sees what',
    body: 'Everyone starts at Free/Busy with times. Sharing more is always your choice, friend by friend and group by group.',
  },
  {
    icon: MapPinOff,
    title: 'Locations are never shared',
    body: 'We share when you’re free, not where you are. We don’t even store rooms or addresses.',
  },
  {
    icon: Trash,
    title: 'Your files don’t stick around',
    body: 'The schedule file you upload is deleted as soon as you confirm your schedule.',
  },
  {
    icon: EyeOff,
    title: 'Pause any time',
    body: 'Need a break? Pause sharing and everyone just sees “Sharing paused”.',
  },
] as const;

function NowPreview() {
  const rows = [
    { name: 'Shanice Walker', hue: 330, tone: 'free', text: 'Free until 4:30 PM' },
    { name: 'Tia-Marie Campbell', hue: 190, tone: 'free', text: 'Free until 5:00 PM' },
    { name: 'Rushane Thompson', hue: 40, tone: 'soon', text: 'Free from 3:00 PM' },
    { name: 'Jordan Campbell', hue: 250, tone: 'busy', text: 'At work until 8:00 PM' },
  ] as const;
  return (
    <div
      role="img"
      aria-label="Example of the Now screen: two friends free now, one free soon, one at work."
      className="w-full max-w-sm rounded-2xl border bg-card p-4 shadow-[0_12px_40px_-12px_rgb(23_21_42/0.18)]"
    >
      <div className="flex items-center justify-between pb-3">
        <span className="font-bold">Now</span>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="size-1.5 rounded-full bg-now-line" />
          Live · 2:30 PM
        </span>
      </div>
      <ul className="flex flex-col gap-1">
        {rows.map((r) => (
          <li key={r.name} className="flex items-center gap-3 rounded-xl px-2 py-2">
            <PersonAvatar name={r.name} hue={r.hue} status={r.tone} />
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-semibold">{r.name}</span>
              <StatusBadge tone={r.tone} className="text-xs">
                {r.text}
              </StatusBadge>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main className="flex-1">
        <section className="mx-auto grid w-full max-w-6xl items-center gap-10 px-4 pt-8 pb-14 sm:px-6 md:grid-cols-[1.1fr_1fr] md:pt-16 md:pb-20">
          <div className="flex flex-col items-start gap-5">
            <span className="inline-flex items-center gap-2 rounded-full bg-status-free-soft px-3 py-1 text-[13px] font-semibold text-status-free-ink">
              <span className="size-2 rounded-full bg-status-free" aria-hidden="true" />
              No more “yuh free?” in the group chat
            </span>
            <h1 className="text-4xl leading-[1.08] font-bold tracking-[-0.03em] text-balance sm:text-5xl">
              See who&apos;s free <span className="text-primary-ink">right now.</span>
            </h1>
            <p className="max-w-xl text-lg text-body-foreground">
              Who&apos;s Free turns your class timetable, work roster or Google Calendar into a live
              free/busy status. Share it with the friends and groups you pick, ping someone
              who&apos;s free, and find a time that works for everybody.
            </p>
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
              <Link
                href="/sign-up"
                className={cn(buttonVariants({ size: 'lg' }), 'w-full sm:w-auto')}
              >
                Sign up free
                <ArrowRight aria-hidden="true" />
              </Link>
              <a
                href="#how-it-works"
                className={cn(
                  buttonVariants({ variant: 'outline', size: 'lg' }),
                  'w-full sm:w-auto',
                )}
              >
                How it works
              </a>
            </div>
            <p className="text-sm text-muted-foreground">
              Sign up with Google. For adults 18 and over.
            </p>
          </div>
          <div className="flex justify-center md:justify-end">
            <NowPreview />
          </div>
        </section>

        <section id="how-it-works" className="border-y bg-card scroll-mt-4">
          <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6">
            <Eyebrow>How it works</Eyebrow>
            <h2 className="mt-2 text-2xl font-bold tracking-[-0.02em] sm:text-3xl">
              Three steps to linking up
            </h2>
            <ol className="mt-8 grid gap-4 md:grid-cols-3">
              {STEPS.map((s, i) => (
                <li
                  key={s.title}
                  className="flex flex-col gap-3 rounded-2xl border bg-background p-5"
                >
                  <span className="flex items-center gap-3">
                    <span className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                      <s.icon aria-hidden="true" className="size-5" />
                    </span>
                    <span className="font-mono text-xs font-medium text-muted-foreground">
                      Step {i + 1}
                    </span>
                  </span>
                  <h3 className="text-lg font-semibold">{s.title}</h3>
                  <p className="text-body-foreground">{s.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="privacy" className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6">
          <Eyebrow>Our privacy promise</Eyebrow>
          <h2 className="mt-2 max-w-2xl text-2xl font-bold tracking-[-0.02em] sm:text-3xl">
            We share your availability, never your whereabouts
          </h2>
          <ul className="mt-8 grid gap-4 sm:grid-cols-2">
            {PROMISES.map((p) => (
              <li key={p.title} className="flex gap-4 rounded-2xl border bg-card p-5">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-status-free-soft text-status-free-ink">
                  <p.icon aria-hidden="true" className="size-5" />
                </span>
                <span className="flex flex-col gap-1">
                  <h3 className="font-semibold">{p.title}</h3>
                  <p className="text-body-foreground">{p.body}</p>
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section id="install" className="border-t bg-card">
          <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-14 sm:px-6 md:grid-cols-[1fr_1.4fr]">
            <div>
              <Eyebrow>Install</Eyebrow>
              <h2 className="mt-2 text-2xl font-bold tracking-[-0.02em] sm:text-3xl">
                Put it on your home screen
              </h2>
              <p className="mt-3 text-body-foreground">
                Who&apos;s Free is a web app, so there&apos;s nothing to download from a store.
                Installing it gives you a home-screen icon and ping notifications.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <InstallSteps
                icon={Smartphone}
                title="Android (Chrome)"
                steps={[
                  'Open Who’s Free in Chrome.',
                  'Tap Install when it pops up, or open the ⋮ menu.',
                  'Choose “Install app” or “Add to Home screen”.',
                ]}
              />
              <InstallSteps
                icon={CalendarDays}
                title="iPhone (Safari)"
                steps={[
                  'Open Who’s Free in Safari.',
                  'Tap the Share button.',
                  'Choose “Add to Home Screen”, then open it from there to get notifications (iOS 16.4+).',
                ]}
              />
            </div>
          </div>
        </section>

        <section className="mx-auto flex w-full max-w-6xl flex-col items-start gap-4 px-4 py-14 sm:px-6 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-[-0.02em]">Ready to link up?</h2>
            <p className="mt-1 text-body-foreground">
              It takes a couple minutes. Bring your timetable or roster.
            </p>
          </div>
          <Link href="/sign-up" className={cn(buttonVariants({ size: 'lg' }), 'w-full md:w-auto')}>
            Sign up free
            <ArrowRight aria-hidden="true" />
          </Link>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}

function InstallSteps({
  icon: Icon,
  title,
  steps,
}: {
  icon: typeof Smartphone;
  title: string;
  steps: string[];
}) {
  return (
    <div className="rounded-2xl border bg-background p-5">
      <h3 className="flex items-center gap-2 font-semibold">
        <Icon aria-hidden="true" className="size-4 text-primary-ink" />
        {title}
      </h3>
      <ol className="mt-3 flex list-decimal flex-col gap-2 pl-5 text-body-foreground marker:font-mono marker:text-xs marker:text-muted-foreground">
        {steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
    </div>
  );
}
