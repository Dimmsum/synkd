import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
      reporter: ['text', 'json-summary'],
      // NFR-OPS-2: the availability engine keeps ≥ 90% coverage. `pnpm test` fails below it.
      thresholds: { lines: 90, branches: 90, functions: 90, statements: 90 },
    },
  },
});
