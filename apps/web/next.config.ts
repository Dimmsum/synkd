import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';
import { withSerwist } from '@serwist/turbopack';

// Credentials live in one `.env` at the repo root (template: `.env.example`), shared by every app
// and package. Load it before Next reads its own env files; variables already set (for example
// in Vercel's settings) take precedence.
const rootEnv = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const nextConfig: NextConfig = {
  // Internal packages ship TypeScript source (no build step), so Next compiles them.
  transpilePackages: ['@whosfree/ui', '@whosfree/shared', '@whosfree/backend'],
  typedRoutes: true,
  poweredByHeader: false,
  // TODO(WF-008): wrap with Sentry once error tracking is added.
};

// Serwist (WF-090): keeps esbuild out of the server bundle so app/serwist/[path]/route.ts can
// build the service worker. The offline Now cache (WF-110) goes in app/sw.ts, not here.
export default withSerwist(nextConfig);
