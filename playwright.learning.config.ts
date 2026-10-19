import { defineConfig, devices } from '@playwright/test';
/** Production browser journey with synthetic APIs; no provider or production calls. */
export default defineConfig({
  testDir: './e2e', testMatch: 'adaptive-ui.spec.ts', fullyParallel: false, workers: 1,
  use: { baseURL: 'http://127.0.0.1:3102', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }, { name: 'mobile-webkit', use: { ...devices['iPhone 13'] } }],
  webServer: {
    command: 'npm run start -- --hostname 127.0.0.1 --port 3102',
    url: 'http://127.0.0.1:3102', reuseExistingServer: false, timeout: 120000,
    env: { STUDIO_BOTS: '0', STUDIO_RELATIONSHIPS: 'off', STUDIO_SCOPED_RELATIONSHIPS: '0', STUDIO_MAINTENANCE: '0',
      STUDIO_IMPROVEMENT_TRUST_JSON: '', STUDIO_DECISIONS_ENABLED: '0', STUDIO_STORAGE: 'file',
      STUDIO_DATA_DIR: '/tmp/vox-learning-browser-qa', VOXX_BOT_TOKEN: '', ANTHROPIC_API_KEY: '',
      OPENAI_API_KEY: '', ELEVENLABS_API_KEY: '', GOOGLE_API_KEY: '', GEMINI_API_KEY: '' },
  },
});
