import type { Metadata, Viewport } from 'next';
import { JetBrains_Mono, Onest } from 'next/font/google';
import './globals.css';

const onest = Onest({
  subsets: ['latin'],
  variable: '--font-onest',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['500'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: "Who's Free — see who's free right now",
    template: "%s · Who's Free",
  },
  description:
    'See which friends are free right now, ping them in one tap, and find a time that works for the whole group. You choose who sees what.',
  applicationName: "Who's Free",
  // TODO(WF-110): add the web app manifest and icons with the PWA work.
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6f5fa' },
    { media: '(prefers-color-scheme: dark)', color: '#15131f' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-JM" className={`${onest.variable} ${jetbrainsMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
