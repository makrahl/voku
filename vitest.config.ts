import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      // Point at source so tests never need a build step first.
      '@voku/shared': resolve(import.meta.dirname, 'packages/shared/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['apps/*/test/**/*.test.ts', 'packages/*/test/**/*.test.ts'],
  },
});
