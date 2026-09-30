import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

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
  // TODO(WF-110): add Serwist (service worker, offline Now cache) here.
};

export default nextConfig;
