import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e/connections', timeout: 30_000, fullyParallel: false, reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:3116', viewport: { width: 390, height: 844 }, trace: 'retain-on-failure',
    launchOptions: { executablePath: process.env.CONNECTIONS_TEST_CHROMIUM } },
  webServer: { command: process.env.CONNECTIONS_E2E_PRODUCTION ? 'npm run start -- --hostname 127.0.0.1 --port 3116' : 'npm run dev -- --hostname 127.0.0.1 --port 3116',
    env: { STUDIO_BOTS: '0', NEXT_TELEMETRY_DISABLED: '1' }, url: 'http://127.0.0.1:3116/studio', reuseExistingServer: !process.env.CI },
});
