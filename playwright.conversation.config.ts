import { defineConfig, devices } from '@playwright/test';

const baseURL = 'http://127.0.0.1:3104';
const production = process.env.CONVERSATION_E2E_PRODUCTION === '1';

export default defineConfig({
  testDir: './e2e',
  testMatch: 'conversation.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: process.env.PLAYWRIGHT_CONVERSATION_OUTPUT_DIR ?? './test-results/conversation',
  use: {
    ...devices['Desktop Chrome'],
    baseURL,
    browserName: 'chromium',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: production
      ? 'STUDIO_BOTS=0 npm run start -- --hostname 127.0.0.1 --port 3104'
      : 'STUDIO_BOTS=0 npm run dev -- --hostname 127.0.0.1 --port 3104',
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      STUDIO_BOTS: '0',
      STUDIO_DECISIONS_ENABLED: '0',
      STUDIO_STORAGE: 'file',
      STUDIO_DATA_DIR: '/tmp/vox-conversation-browser-qa',
      VOXX_BOT_TOKEN: '',
      ANTHROPIC_API_KEY: '',
      OPENAI_API_KEY: '',
      ELEVENLABS_API_KEY: '',
      GOOGLE_API_KEY: '',
      GEMINI_API_KEY: '',
    },
  },
});
