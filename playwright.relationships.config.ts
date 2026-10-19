import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', testMatch: 'relationships.spec.ts', fullyParallel: false, workers: 1,
  use: { baseURL: 'http://127.0.0.1:3100', trace: 'on-first-retry' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }, { name: 'mobile-webkit', use: { ...devices['iPhone 13'] } }],
  webServer: {
    command: process.env.RELATIONSHIP_E2E_PRODUCTION === '1'
      ? 'npm run start -- --hostname 127.0.0.1 --port 3100'
      : 'npm run dev -- --hostname 127.0.0.1 --port 3100',
    url: 'http://127.0.0.1:3100', reuseExistingServer: false, timeout: 120000,
    env: { STUDIO_BOTS: '0', STUDIO_RELATIONSHIPS: 'off' },
  },
});
