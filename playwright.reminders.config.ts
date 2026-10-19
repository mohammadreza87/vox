import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', testMatch: 'reminders.spec.ts', workers: 1, retries: 0,
  outputDir: process.env.PLAYWRIGHT_REMINDERS_OUTPUT_DIR ?? './test-results/reminders',
  use: { baseURL: 'http://127.0.0.1:3106', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }, { name: 'mobile-webkit', use: { ...devices['iPhone 13'] } }],
  webServer: { command: 'node e2e/start-conversation-server.mjs', url: 'http://127.0.0.1:3106', reuseExistingServer: false,
    env: { STUDIO_E2E_PORT: '3106', STUDIO_BOTS: '0', STUDIO_REMINDER_DELIVERY: '0', STUDIO_RELATIONSHIPS: 'off', STUDIO_SCOPED_RELATIONSHIPS: '0', STUDIO_MAINTENANCE: '0', STUDIO_DECISIONS_ENABLED: '0', STUDIO_IMPROVEMENT_TRUST_JSON: '', STUDIO_ADAPTIVE_POLICY_JSON: '', STUDIO_STORAGE: 'file', STUDIO_DATA_DIR: '/tmp/vox-reminders-browser-qa', VOXX_BOT_TOKEN: '', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', ELEVENLABS_API_KEY: '', GOOGLE_API_KEY: '', GEMINI_API_KEY: '' },
  },
});
