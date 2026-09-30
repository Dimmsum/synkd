import type { MetadataRoute } from 'next';

// Web app manifest, served at /manifest.webmanifest (FR-PWA-1, WF-090). Android Chrome builds its
// splash screen from `name`, `background_color` and the 512px icon. iOS Safari reads `display` and
// the name from here, and its launch images and touch icon from the root layout's metadata.
// Colours are the design tokens: page background #F6F5FA, primary oklch(0.52 0.2 280) = #594fd7.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: "Who's Free",
    short_name: "Who's Free",
    description: 'See which friends are free right now and ping them in one tap.',
    lang: 'en-JM',
    dir: 'ltr',
    start_url: '/now',
    scope: '/',
    display: 'standalone',
    background_color: '#f6f5fa',
    theme_color: '#f6f5fa',
    categories: ['social', 'productivity'],
    prefer_related_applications: false,
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: '/icons/icon-maskable-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
