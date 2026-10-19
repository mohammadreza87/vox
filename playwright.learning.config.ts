import { defineConfig, devices } from '@playwright/test';
/** Production browser journey with synthetic APIs; no provider or production calls. */
export default defineConfig({
  testDir: './e2e', testMatch: 'adaptive-ui.spec.ts', fullyParallel: false, workers: 1,
  use: { baseURL: 'http://127.0.0.1:3102', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }, { name: 'mobile-webkit', use: { ...devices['iPhone 13'] } }],
  webServer: {
    command: 'npm run start -- --hostname 127.0.0.1 --port 3102',
    url: 'http://127.0.0.1:3102', reuseExistingServer: false, timeout: 120000,
    env: { STUDIO_BOTS: '0', STUDIO_RELATIONSHIPS: 'off' },
  },
});
