import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Internal packages ship TypeScript source (no build step), so Next compiles them.
  transpilePackages: ['@whosfree/ui', '@whosfree/shared'],
  typedRoutes: true,
  poweredByHeader: false,
  // TODO(WF-008): wrap with Sentry once error tracking is added.
  // TODO(WF-110): add Serwist (service worker, offline Now cache) here.
};

export default nextConfig;
