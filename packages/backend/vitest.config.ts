import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/harness/global-setup.ts'],
    // Each test file runs its own in-memory Postgres; allow for slow CI machines.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
