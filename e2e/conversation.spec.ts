import { expect, test, type Page } from '@playwright/test';

const PERSON = 780001;
const AGENT_ID = 'fixture-conversation-agent';
const agent = {
  id: AGENT_ID,
  status: 'active',
  persona: { name: 'Fixture Agent', role: 'Synthetic QA', tagline: 'Test only', backstory: '', personality: '',
    communicationStyle: '', values: [], expertise: [], wontDo: '', languages: ['en', 'fa'], culture: '',
    presentation: 'neutral', age: 'adult', accent: '', voiceBrief: '', avatarHint: '' },
  look: { hue: 'ash', family: 'drift', features: { cheeks: false, lashes: false, brows: false } },
  locked: true, formingDay: null, isAdmin: true, visibility: 'private', access: [PERSON], createdBy: PERSON,
  canEdit: false, canFire: false, canManageAccess: false, liveWeb: false,
};

type FixtureBody = Record<string, unknown>;
type ApiCall = { method: string; path: string; body?: FixtureBody };

async function installFixtures(page: Page) {
  const calls: ApiCall[] = [];
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://127.0.0.1:3104') return route.abort();
    return route.continue();
  });
  await page.route('https://telegram.org/js/telegram-web-app.js', route => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: 'window.Telegram = { WebApp: { initData: "", ready() {}, expand() {}, setHeaderColor() {}, setBackgroundColor() {}, disableVerticalSwipes() {}, openTelegramLink() {}, openLink() {} } };',
  }));
  await page.addInitScript(() => {
    (window as Window & { __microphoneCalls?: number }).__microphoneCalls = 0;
    const media = navigator.mediaDevices;
    if (media) Object.defineProperty(media, 'getUserMedia', { configurable: true, value: () => {
      (window as Window & { __microphoneCalls?: number }).__microphoneCalls!++;
      return Promise.reject(new Error('microphone access is forbidden in this synthetic test'));
    } });
  });
  await page.route('**/api/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (!url.pathname.startsWith('/api/studio/')) return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
    const path = url.pathname.slice('/api/studio/'.length);
    let body: FixtureBody | undefined;
    try { body = request.postDataJSON(); } catch { body = undefined; }
    calls.push({ method: request.method(), path, body });
    let result: unknown = {};
    if (path === 'me') result = { member: { telegramId: PERSON, name: 'Synthetic Owner', role: 'owner', joinedAt: '2026-01-01T00:00:00.000Z' }, org: 'Synthetic Org', bot: 'fixturebot', features: { avatars: false, voices: false, calls: false } };
    else if (path === 'agents') result = { agents: [agent] };
    else if (path === 'product-pause' && request.method() === 'GET') result = { version: 1, accountId: 'synthetic-account',
      space: url.searchParams.get('space') === 'personal' ? 'personal' : 'work', available: false,
      reason: 'store_not_prepared', productPaused: null, useEpoch: null, canPause: false, canResume: false };
    else if (path === `agents/${AGENT_ID}`) result = { agent };
    else if (path === 'conversation') result = { reply: `Synthetic ${typeof body?.space === 'string' ? body.space : 'work'} reply` };
    else if (path === 'adaptive') {
      const space = url.searchParams.get('space') === 'personal' ? 'personal' : 'work';
      result = { schemaVersion: 1, identity: { accountId: 'synthetic-account', personId: 'synthetic-person', bindingId: 'synthetic-binding', bindingRevision: 1,
        confirmed: true, verification: 'account_confirmation', adultDeclared: true, declaredJurisdiction: 'EE' }, space, revision: 1,
        purposes: [], memories: [], explicitMemoryAvailable: true, agents: [{ agentId: AGENT_ID, allowed: false, revision: 1 }], scope: 'private_account_profile' };
    }
    else if (path === 'voice-identity') {
      const space = url.searchParams.get('space') === 'personal' ? 'personal' : 'work';
      result = { scope: { space, deviceId: url.searchParams.get('deviceId') }, revision: 1, available: false,
        reason: 'provider_unavailable', consent: 'not_asked', enrollment: 'none', deletion: 'not_required', backupExpiry: 'operator_policy' };
    }
    else return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"unmapped synthetic API"}' });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(result) });
  });
  return calls;
}

async function runConversationJourney(page: Page, testInfo: { outputPath: (name: string) => string }) {
  const calls = await installFixtures(page);
  await page.goto('/studio');
  await page.getByRole('button', { name: 'Fixture Agent, Synthetic QA' }).click();
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Type or share an image' });
  await expect(panel).toBeVisible();
  await expect(page.getByRole('group', { name: 'Conversation space' })).toBeVisible();
  await expect(panel.getByRole('checkbox', { name: 'Prepare while I type' })).not.toBeChecked();

  const message = 'Synthetic text with a selected image';
  await panel.getByLabel('Message').fill(message);
  await panel.getByLabel('Image (optional)').setInputFiles({
    name: 'synthetic.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', 'base64'),
  });
  await expect(panel.getByRole('img', { name: 'Image selected for this message' })).toBeVisible();
  await panel.getByRole('button', { name: 'Send' }).click();
  await expect(panel.getByRole('log', { name: 'Conversation' })).toContainText(message);
  await expect(panel.getByRole('log', { name: 'Conversation' })).toContainText('Synthetic work reply');
  const workTurn = calls.find(call => call.path === 'conversation');
  expect(workTurn?.body).toMatchObject({ agentId: AGENT_ID, space: 'work', text: message });
  expect(workTurn?.body?.image).toMatch(/^data:image\/jpeg;base64,/);
  expect(calls.some(call => /experience\/(predict|prediction-cancel|prediction-validate)$/.test(call.path))).toBe(false);

  await page.getByRole('button', { name: 'Personal' }).click();
  await expect(panel.getByRole('log', { name: 'Conversation' })).toBeEmpty();
  const personalMessage = 'Synthetic personal message';
  await panel.getByLabel('Message').fill(personalMessage);
  await panel.getByRole('button', { name: 'Send' }).click();
  await expect(panel.getByRole('log', { name: 'Conversation' })).toContainText('Synthetic personal reply');
  expect(calls.filter(call => call.path === 'conversation').at(-1)?.body).toMatchObject({ agentId: AGENT_ID, space: 'personal', text: personalMessage });
  await page.screenshot({ path: testInfo.outputPath('conversation-en.png'), fullPage: true });

  await page.getByRole('button', { name: 'فارسی' }).click();
  const faPanel = page.getByRole('region', { name: 'تایپ یا اشتراک تصویر' });
  await expect(faPanel).toHaveAttribute('dir', 'rtl');
  await expect(faPanel).toHaveAttribute('lang', 'fa');
  await expect(faPanel.getByLabel('پیام')).toBeVisible();
  await expect(faPanel.getByRole('checkbox', { name: 'آماده‌سازی هنگام تایپ' })).not.toBeChecked();
  const persianMessage = 'پیام آزمایشی فارسی';
  await faPanel.getByLabel('پیام').fill(persianMessage);
  await faPanel.getByRole('button', { name: 'ارسال' }).click();
  await expect(faPanel.getByRole('log', { name: 'گفتگو' })).toContainText(persianMessage);
  expect(calls.filter(call => call.path === 'conversation').at(-1)?.body).toMatchObject({ agentId: AGENT_ID, space: 'personal', text: persianMessage });
  await page.screenshot({ path: testInfo.outputPath('conversation-fa.png'), fullPage: true });

  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('button', { name: 'Agents' }).click();
  await page.getByRole('button', { name: 'Privacy' }).click();
  const voice = page.getByRole('region', { name: 'Optional voice recognition' });
  await expect(voice).toBeVisible();
  await expect(voice.getByRole('status')).toContainText('Recognition is unavailable');
  await expect(voice.getByRole('button', { name: 'Review enrollment' })).toHaveCount(0);
  await page.locator('.vx-privacy').getByLabel('Language').selectOption('fa');
  const voiceFa = page.getByRole('region', { name: 'تشخیص اختیاری صدا' });
  await expect(voiceFa.getByRole('status')).toContainText('تشخیص صدا برای این نمایه');
  await expect(voiceFa.getByRole('button', { name: 'بررسی ثبت صدا' })).toHaveCount(0);
  expect(await page.evaluate(() => (window as Window & { __microphoneCalls?: number }).__microphoneCalls)).toBe(0);
}

for (const viewport of [
  { label: 'desktop', size: { width: 1280, height: 900 } },
  { label: 'mobile', size: { width: 390, height: 844 } },
]) {
  test(`conversation and voice fallback are isolated on ${viewport.label}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport.size);
    await runConversationJourney(page, testInfo);
  });
}
