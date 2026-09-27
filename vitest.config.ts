import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const sharedEntry = fileURLToPath(new URL('./packages/shared/src/index.ts', import.meta.url));

export default defineConfig({
  resolve: { alias: { '@smart-rss/shared': sharedEntry } },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'shared',
          include: ['packages/shared/src/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        extends: true,
        test: { name: 'server', include: ['apps/server/src/**/*.test.ts'], environment: 'node' },
      },
      {
        extends: true,
        plugins: [react()],
        test: {
          name: 'web',
          include: ['apps/web/src/**/*.test.{ts,tsx}'],
          environment: 'jsdom',
          setupFiles: ['apps/web/src/test/setup.ts'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      // UI components are covered by the Playwright E2E suite; unit coverage targets logic modules.
      include: ['packages/shared/src/**', 'apps/server/src/**', 'apps/web/src/lib/**'],
      exclude: ['**/*.test.*', 'apps/server/src/index.ts'],
      thresholds: { lines: 80, functions: 80, branches: 75, statements: 80 },
    },
  },
});
