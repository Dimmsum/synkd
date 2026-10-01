import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // The converter tests compile WASM engines and render images, which slows the other files
    // running beside them.
    testTimeout: 20_000,
  },
});
