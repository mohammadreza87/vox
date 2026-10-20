import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', testMatch: 'observation.spec.ts', workers: 1, retries: 0, reporter: [['list']],
  outputDir: './test-results/observation',
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:3105', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: {
    command: 'node e2e/start-conversation-server.mjs', url: 'http://127.0.0.1:3105', reuseExistingServer: false, timeout: 120000,
    env: { STUDIO_E2E_PORT: '3105', STUDIO_BOTS: '0', STUDIO_DECISIONS_ENABLED: '0', STUDIO_DECISIONS: 'off', STUDIO_RELATIONSHIPS: 'off',
      STUDIO_SCOPED_RELATIONSHIPS: '0', STUDIO_MAINTENANCE: '0', STUDIO_IMPROVEMENT_TRUST_JSON: '', STUDIO_ADAPTIVE_POLICY_JSON: '',
      STUDIO_STORAGE: 'file', STUDIO_DATA_DIR: '/tmp/vox-observation-browser-synthetic', VOXX_BOT_TOKEN: '', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '',
      ELEVENLABS_API_KEY: '', GOOGLE_API_KEY: '', GEMINI_API_KEY: '', NEXT_PUBLIC_SENTRY_DSN: '', SENTRY_DSN: '', NEXT_TELEMETRY_DISABLED: '1' },
  },
});
