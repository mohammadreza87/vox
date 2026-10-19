import { defineConfig, devices } from '@playwright/test';

const baseURL = 'http://127.0.0.1:3102';

export default defineConfig({
  testDir: '.',
  testMatch: 'adaptive-ui.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: process.env.PLAYWRIGHT_ADAPTIVE_OUTPUT_DIR ?? '../test-results/adaptive',
  use: {
    ...devices['iPhone 13'],
    baseURL,
    browserName: 'chromium',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run start -- --hostname 127.0.0.1 --port 3102',
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      STUDIO_BOTS: '0',
      STUDIO_DECISIONS_ENABLED: '0',
      STUDIO_STORAGE: 'file',
      STUDIO_DATA_DIR: '/tmp/vox-browser-qa-20261019',
      VOXX_BOT_TOKEN: '',
      ANTHROPIC_API_KEY: '',
      OPENAI_API_KEY: '',
      ELEVENLABS_API_KEY: '',
      GOOGLE_API_KEY: '',
      GEMINI_API_KEY: '',
    },
  },
});
