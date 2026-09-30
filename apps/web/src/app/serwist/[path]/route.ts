import { spawnSync } from 'node:child_process';
import { createSerwistRoute } from '@serwist/turbopack';

// Builds `app/sw.ts` with esbuild at `next build` time and serves it as /serwist/sw.js
// (FR-PWA-1, WF-090). The route is fully static. The precache manifest is the build output
// in .next/static plus public/, minus the iOS launch images (Safari fetches those itself when the
// app is added to the Home Screen, so precaching them would only cost every other user bandwidth).

// A new revision per commit, so the precached /offline page is refreshed on every deploy.
const revision =
  process.env.VERCEL_GIT_COMMIT_SHA ??
  (spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf-8' }).stdout?.trim() ||
    crypto.randomUUID());

export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } = createSerwistRoute(
  {
    swSrc: 'src/app/sw.ts',
    additionalPrecacheEntries: [{ url: '/offline', revision }],
    globIgnores: ['**/node_modules/**/*', 'public/splash/**/*'],
    useNativeEsbuild: true,
  },
);
