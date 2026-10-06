import type { Metadata, Viewport } from 'next';
import { JetBrains_Mono, Onest } from 'next/font/google';
import { ClerkProvider } from '@clerk/nextjs';
import { clerkAppearance } from '@/lib/auth/clerk-appearance';
import { SerwistProvider } from '@serwist/turbopack/react';
import { InstallCapture } from '@/components/pwa/install-capture';
import { SW_URL, pwaMetadata } from '@/lib/pwa';
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
    default: "synkd — see who's free right now",
    template: '%s · synkd',
  },
  description:
    'See which friends are free right now, ping them in one tap, and find a time that works for the whole group. You choose who sees what.',
  applicationName: 'synkd',
  // The manifest itself is app/manifest.ts (WF-090).
  ...pwaMetadata,
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
      <body>
        {/* Clerk (D19, WF-004). Since Clerk Core 3 the provider goes inside <body>. */}
        <ClerkProvider appearance={clerkAppearance} afterSignOutUrl="/">
          {/* Registers the service worker in production only (WF-090). Navigations are never
              cached (cacheOnNavigation off) and the page isn't force-reloaded when back online. */}
          <SerwistProvider
            swUrl={SW_URL}
            disable={process.env.NODE_ENV !== 'production'}
            cacheOnNavigation={false}
            reloadOnOnline={false}
            options={{ scope: '/', type: 'classic' }}
          >
            {children}
          </SerwistProvider>
          {/* Catches the install prompt on any page (WF-111). */}
          <InstallCapture />
        </ClerkProvider>
      </body>
    </html>
  );
}
