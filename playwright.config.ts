import { defineConfig, devices } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const APP_PORT = 8098;
const FIXTURE_PORT = 4599;
const dataDir = join(tmpdir(), `smart-rss-e2e-${Date.now()}`);

/** Runs against the production build: `npm run build` first. */
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${APP_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'npx tsx e2e/serve-fixtures.ts',
      url: `http://127.0.0.1:${FIXTURE_PORT}/health`,
      env: { FIXTURE_PORT: String(FIXTURE_PORT) },
      reuseExistingServer: false,
    },
    {
      command: 'node apps/server/dist/index.js',
      url: `http://127.0.0.1:${APP_PORT}/api/health`,
      env: {
        PORT: String(APP_PORT),
        DATA_DIR: dataDir,
        WEB_DIST_DIR: 'apps/web/dist',
        LOG_LEVEL: 'warn',
        SCHEDULER_TICK_SECONDS: '5',
        SEED_STARTER_SOURCES: 'false',
        ADMIN_USERNAME: 'admin',
        ADMIN_PASSWORD: 'e2e-admin-password',
      },
      reuseExistingServer: false,
    },
  ],
});
