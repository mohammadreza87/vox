import { defineConfig, devices } from '@playwright/test';

/**
 * Studio flows again with the OS asking for less motion: cross-fade fallbacks must still render and navigate.
 * Here: the studio specs this config runs. The flows with their own servers and fixtures (conversation,
 * observation, adaptive-ui, relationships) carry a reduced-motion project in their own configs.
 */
const studioReducedMotion = {
  name: 'studio-reduced-motion',
  testMatch: ['**/connections/studio.spec.ts', '**/relationships.spec.ts'],
  use: { ...devices['Pixel 7'], contextOptions: { reducedMotion: 'reduce' as const } },
};

/**
 * Playwright E2E test configuration
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './e2e',
  // The adaptive journey uses its own production server and synthetic API fixtures.
  testIgnore: ['**/adaptive-ui.spec.ts', '**/conversation.spec.ts', '**/reminders.spec.ts', '**/observation.spec.ts', '**/guest-rights.spec.ts', '**/guest-fixture-build.test.mjs'],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',

  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: process.env.CI
    ? [
        {
          name: 'chromium',
          use: { ...devices['Desktop Chrome'] },
        },
        studioReducedMotion,
      ]
    : [
        {
          name: 'chromium',
          use: { ...devices['Desktop Chrome'] },
        },
        {
          name: 'Mobile Safari',
          use: { ...devices['iPhone 13'] },
        },
        studioReducedMotion,
      ],

  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },
});
