import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react(), tailwind()],
  resolve: {
    alias: {
      '@voku/shared': resolve(import.meta.dirname, '../../packages/shared/src/index.ts'),
    },
  },
  server: {
    port: 5173,
    // The API lives on the server app in development; in production both are
    // served from the same origin, so no proxy exists and none is needed.
    proxy: { '/api': 'http://localhost:3000' },
  },
  build: {
    // Built straight into the server's static directory: one deployable.
    outDir: resolve(import.meta.dirname, '../server/public'),
    emptyOutDir: true,
  },
});
