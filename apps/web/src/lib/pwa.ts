import type { Metadata } from 'next';

// PWA metadata for the root layout (FR-PWA-1, WF-090). Kept here so the layout stays small.
// Every file referenced here lives in public/ and must be reachable without signing in.

/** Where the service worker is served (see app/serwist/[path]/route.ts). */
export const SW_URL = '/serwist/sw.js';

/**
 * Portrait iPhone launch screens as physical pixels at a device pixel ratio. iOS only shows a
 * launch image whose media query matches the device exactly, and falls back to a blank screen in
 * the manifest's background colour otherwise (iPads, landscape).
 */
const IPHONE_SPLASH = [
  { w: 750, h: 1334, dpr: 2 },
  { w: 828, h: 1792, dpr: 2 },
  { w: 1125, h: 2436, dpr: 3 },
  { w: 1170, h: 2532, dpr: 3 },
  { w: 1179, h: 2556, dpr: 3 },
  { w: 1206, h: 2622, dpr: 3 },
  { w: 1242, h: 2688, dpr: 3 },
  { w: 1284, h: 2778, dpr: 3 },
  { w: 1290, h: 2796, dpr: 3 },
  { w: 1320, h: 2868, dpr: 3 },
] as const;

export const SPLASH_SCREENS = IPHONE_SPLASH.map(({ w, h, dpr }) => ({
  url: `/splash/splash-${w}x${h}.png`,
  media: `(device-width: ${w / dpr}px) and (device-height: ${h / dpr}px) and (-webkit-device-pixel-ratio: ${dpr}) and (orientation: portrait)`,
}));

export const pwaMetadata = {
  icons: {
    icon: [
      { url: '/icons/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  appleWebApp: {
    capable: true,
    title: 'synkd',
    statusBarStyle: 'default',
    startupImage: SPLASH_SCREENS,
  },
  // Next only emits the unprefixed `mobile-web-app-capable`. Older iOS versions only show launch
  // images when the prefixed tag is present too.
  other: { 'apple-mobile-web-app-capable': 'yes' },
} satisfies Metadata;
