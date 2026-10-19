import { expect, test, type Page, type Locator } from '@playwright/test';
import type { PreferenceInput, PreferenceState, StoredPreference } from '../src/lib/adaptive/runtime/contracts';
import type { PreferenceValue } from '../src/lib/adaptive/personalization';

const PERSON = 710001;
const OTHER = 710002;
const AGENT = 'fixture-agent';
const NOW = Date.parse('2026-10-19T12:00:00Z');
const purposes = [
  'optional.product_analytics', 'optional.personalization', 'optional.auto_memory',
  'optional.biometric_recognition', 'optional.reminder_delivery',
  'optional.proactive_suggestions', 'optional.content_quality_review',
] as const;

function makeHarness() {
  const calls: Array<{ method: string; path: string; body?: any; space?: string }> = [];
  const processed: Record<string, boolean> = { work: false, personal: false };
  const granted: Record<string, boolean> = { work: false, personal: false };
  // Mirror the current projection: records are distinct per agent, space and
  // setting; reset is a retained explicit row, not an absent preference.
  let revision = 1;
  const preferences: Record<string, StoredPreference> = {};
  const defaults: PreferenceValue[] = [{ key: 'response_length', value: 'balanced' }, { key: 'language', value: 'auto' }, { key: 'formatting', value: 'plain' }];
  const preferenceKey = (space: string, agentId: string, key: string) => `${space}:${agentId}:${key}`;
  const preferenceValue = (space: string, agentId: string, key: string) => {
    const row = preferences[preferenceKey(space, agentId, key)]; return row?.status === 'active' ? row.setting.value : undefined;
  };
  const preferenceState = (space: 'work' | 'personal', agentId: string): PreferenceState => ({
    schemaVersion: 1, revision, space, agentId, receipt: `synthetic-projection:${space}:${agentId}:${revision}`,
    entries: defaults.map(setting => {
      const saved = preferences[preferenceKey(space, agentId, setting.key)];
      // This fixture has no adaptive agent grant: saving a choice must not
      // silently make it applied or revive permissions.
      return { setting, source: 'default', applied: false,
        explanation: granted[space] ? 'agent_grant_missing' : 'personalization_off', ...(saved ? { saved } : {}) };
    }),
  });
  const savePreference = (body: PreferenceInput): boolean => {
    if (body?.expectedRevision !== revision) return false;
    const key = preferenceKey(body.space, body.agentId, body.setting.key), prior = preferences[key];
    preferences[key] = { id: prior?.id ?? body.eventId, revision: (prior?.revision ?? 0) + 1, space: body.space, agentId: body.agentId,
      setting: body.setting, status: body.action === 'reset' ? 'reset' : 'active', updatedAt: NOW };
    revision++; return true;
  };
  const sharedNotes: Record<string, string[]> = { work: ['Synthetic work note'], personal: ['Synthetic personal note'] };
  const settings: any = {
    revision: 1, timezone: 'Europe/Tallinn', dailyCap: 2, quietStartHour: 21, quietEndHour: 8,
    work: { inboxEnabled: false, proactiveEnabled: false, reminderEnabled: false },
    personal: { inboxEnabled: false, proactiveEnabled: false, reminderEnabled: false },
  };
  const notice = (purpose: string, locale: 'en' | 'fa' = 'en') => ({ id: `notice:${purpose}`, version: 'fixture-v1',
    title: locale === 'fa' ? 'انتخاب اختیاری' : 'Optional choice',
    body: locale === 'fa' ? 'این مجوز اختیاری است و هر زمان می‌توانید آن را خاموش کنید.' : 'This optional permission can be turned off at any time.',
    locale, copyHash: 'synthetic-copy-hash' });
  const adaptive = (space: 'work' | 'personal', locale: 'en' | 'fa' = 'en') => ({
    schemaVersion: 1,
    identity: { accountId: 'acct-synthetic', personId: 'person-synthetic', bindingId: 'binding-synthetic', bindingRevision: 1,
      confirmed: true, verification: 'account_confirmation', adultDeclared: true, declaredJurisdiction: 'EE' },
    space, revision: 1,
    purposes: purposes.map(purpose => ({ purpose, state: purpose === 'optional.personalization' && granted[space] ? 'granted' : 'off',
      revision: granted[space] && purpose === 'optional.personalization' ? 2 : 1,
      available: purpose === 'optional.personalization' || purpose === 'optional.product_analytics', notice: notice(purpose, locale) })),
    memories: [], explicitMemoryAvailable: true,
    agents: [{ agentId: AGENT, allowed: false, revision: 1 }], scope: 'private_account_profile',
  });
  const shared = (space: 'work' | 'personal') => ({ revision: 1, space, containers: sharedNotes[space].map((text, i) => ({
    id: `${space}-container-${i}`, space, kind: 'selected', revision: 1, ownerPersonId: 'person-synthetic',
    recipients: [{ telegramId: PERSON, personId: 'person-synthetic', active: true }, { telegramId: OTHER, personId: 'person-other', active: true }],
    agents: [], status: 'active', memories: [{ id: `${space}-memory-${i}`, revision: 1, text, authorPersonId: 'person-synthetic', createdAt: NOW, expiresAt: NOW + 86400000 }],
  })) });
  const experience = (space: 'work' | 'personal') => ({ schemaVersion: 1, revision, space, confirmed: true,
    preferences: Object.values(preferences).filter(row => row.space === space).map(row => ({ ...row, applied: false })),
    settings: { ...settings, [space]: settings[space] }, inbox: [],
    observations: { available: false, responded: 0, failed: 0, cancelled: 0, total: 0, meanResponseMs: null, verifiedTaskSuccess: null, complete: false },
    capabilities: { personalization: true, productAnalytics: false, proactiveInbox: false, reminders: false, decisions: false },
  });
  const learning = (space: 'work' | 'personal') => ({ schemaVersion: 1, version: 'vox-observer-v1', space, available: space === 'work',
    projection: { space, sourceDigest: 'PRIVATE_DIGEST_CANARY', sourceEvents: 16, responded: processed[space] ? 13 : 12, failed: 1, cancelled: 0,
      unknownResponses: 0, taskOutcomesUnknown: 13, timedResponses: 0, responseTurns: 13, meanResponseMs: null,
      playbackStarted: 2, playbackCompleted: 1, playbackFailed: 1, interruptions: 0, playbackUnknown: 11, findings: [] },
    findings: space === 'work' ? [{ id: 'PRIVATE_FINDING_CANARY', rule: 'playback_failure', count: 1, evidenceIds: ['PRIVATE_EVENT_CANARY'], inferredCause: null }] : [],
    queue: { pending: processed[space] ? 0 : 2, leased: 0, failed: 1, oldestPendingAgeMs: 100, lastProcessedAt: processed[space] ? NOW : null },
    completeness: { complete: false, acceptedEvents: 16, processedEvents: processed[space] ? 16 : 14, pendingEvents: processed[space] ? 0 : 2, failedEvents: 1,
      samplingRate: 1, retentionMs: 604800000, coverage: 'instrumented_response_and_client_playback_only', playbackEvidence: 'client_unverified', verifiedTaskSuccess: null, providerUsage: null, language: null, release: null },
  });
  return { calls, sharedNotes, settings, adaptive, shared, experience, learning, processed, granted, preferences, preferenceValue, preferenceState, savePreference };
}

async function installFixtures(page: Page, h: ReturnType<typeof makeHarness>) {
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://127.0.0.1:3102') return route.abort();
    return route.continue();
  });
  await page.route('https://telegram.org/js/telegram-web-app.js', route => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: 'window.Telegram = { WebApp: { initData: "", ready() {}, expand() {}, setHeaderColor() {}, setBackgroundColor() {}, disableVerticalSwipes() {}, openTelegramLink() {}, openLink() {} } };',
  }));
  await page.route('**/api/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (!url.pathname.startsWith('/api/studio/')) return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"unavailable in synthetic browser run"}' });
    const path = url.pathname.slice('/api/studio/'.length);
    const method = request.method();
    let body: any;
    try { body = request.postDataJSON(); } catch { body = undefined; }
    h.calls.push({ method, path, body, space: url.searchParams.get('space') ?? undefined });
    const space = (url.searchParams.get('space') === 'personal' || body?.space === 'personal' ? 'personal' : 'work') as 'work' | 'personal';
    let result: any;
    let status = 200;
    if (path === 'me') result = { member: { telegramId: PERSON, name: 'Synthetic Owner', role: 'owner', joinedAt: '2026-01-01T00:00:00.000Z' }, org: 'Synthetic Org', bot: 'fixturebot', features: { avatars: false, voices: false, calls: false } };
    else if (path === 'agents') result = { agents: [{ id: AGENT, status: 'active', persona: { name: 'Fixture Agent', role: 'QA fixture', tagline: 'Synthetic only', backstory: '', personality: '', communicationStyle: '', values: [], expertise: [], wontDo: '', languages: ['en', 'fa'], culture: '', presentation: 'neutral', age: 'adult', accent: '', voiceBrief: '', avatarHint: '' }, look: { hue: 'ash', family: 'drift', features: { cheeks: false, lashes: false, brows: false } }, locked: true, formingDay: null, isAdmin: true, visibility: 'private', access: [PERSON], createdBy: PERSON, canEdit: false, canFire: false, canManageAccess: false }] };
    else if (path === 'members') result = { people: [
      { telegramId: PERSON, name: 'Synthetic Owner', role: 'owner', joinedAt: '2026-01-01T00:00:00.000Z' },
      { telegramId: OTHER, name: 'Synthetic Guest', role: 'member', joinedAt: '2026-01-02T00:00:00.000Z' },
    ], agentAdmins: [] };
    else if (path === 'groups') result = { groups: [] };
    else if (path === 'adaptive' && method === 'GET') result = h.adaptive(space, (url.searchParams.get('locale') === 'fa' ? 'fa' : 'en'));
    else if (path === 'adaptive/consents/present') result = { ...h.adaptive(space, body?.locale ?? 'en'), receipt: 'synthetic-receipt', notice: h.adaptive(space, body?.locale ?? 'en').purposes.find((p: any) => p.purpose === body?.purpose)?.notice };
    else if (path === 'adaptive/consents') {
      h.granted[space] = body?.state === 'granted'; result = h.adaptive(space);
    }
    else if (path === 'shared' && method === 'GET') result = h.shared(space);
    else if (path === 'shared/preview') result = { previewToken: 'synthetic-preview-token', expiresAt: NOW + 60000,
      recipients: [{ telegramId: PERSON, personId: 'person-synthetic' }, { telegramId: OTHER, personId: 'person-other' }], authorityRevision: 'synthetic-authority-v1' };
    else if (path === 'shared/containers') {
      h.sharedNotes[space].push(body?.text ?? 'Synthetic shared note'); result = h.shared(space); status = 201;
    }
    else if (path === 'learning/observations' && method === 'GET') result = h.learning(space);
    else if (path === 'learning/observations/process' && method === 'POST') { h.processed[space] = true; result = h.learning(space); }
    else if (path === 'learning/export' && method === 'GET') result = { schemaVersion: 1, space, lifecycle: { observations: h.learning(space) } };
    else if (path === 'learning/operations' && method === 'GET') result = { maintenanceConfigured: false, improvementConfigured: false, report: null };
    else if (path === 'experience' && method === 'GET') result = h.experience(space);
    else if (path === 'experience/preferences' && method === 'GET') {
      const agentId = url.searchParams.get('agentId');
      if (agentId !== AGENT) { status = 403; result = { error: 'agent_access_denied' }; }
      else result = h.preferenceState(space, agentId);
    }
    else if (path === 'experience/preferences' && method === 'PUT') {
      if (!h.savePreference(body)) { status = 409; result = { error: 'revision_conflict' }; }
      else result = h.experience(space);
    }
    else if (path === 'experience/settings') {
      h.settings[space] = { inboxEnabled: body.inboxEnabled, proactiveEnabled: body.proactiveEnabled, reminderEnabled: body.reminderEnabled };
      h.settings.timezone = body.timezone; h.settings.dailyCap = body.dailyCap; h.settings.quietStartHour = body.quietStartHour; h.settings.quietEndHour = body.quietEndHour;
      result = h.experience(space);
    }
    else return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"unmapped synthetic API"}' });
    return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(result) });
  });
}

async function checkNoHorizontalOverflow(page: Page) {
  const dimensions = await page.locator('.vx-privacy').last().evaluate(el => ({ scroll: el.scrollWidth, client: el.clientWidth }));
  expect(dimensions.scroll, `horizontal overflow ${dimensions.scroll}px > ${dimensions.client}px`).toBeLessThanOrEqual(dimensions.client + 1);
}

async function waitForScreenSettled(page: Page) {
  const screens = page.locator('.vx-privacy');
  await expect(screens).toHaveCount(1);
  await expect.poll(() => screens.evaluate(el => {
    const style = getComputedStyle(el.parentElement!);
    const offsetX = style.transform === 'none' ? 0 : new DOMMatrixReadOnly(style.transform).m41;
    return `${style.opacity}:${offsetX}`;
  })).toBe('1:0');
}

test('privacy, shared memory and experience controls stay explicit and isolated on mobile', async ({ page }, testInfo) => {
  const h = makeHarness();
  const browserErrors: string[] = [];
  page.on('pageerror', error => browserErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') browserErrors.push(`console:${message.text()}@${JSON.stringify(message.location())}`); });
  page.on('request', request => { if (/\/(?:_next|api)\//.test(request.url()) || request.url().includes('telegram.org')) browserErrors.push(`request:${request.method()}:${request.url()}`); });
  page.on('response', response => { if (response.url().includes('/_next/static/chunks/')) browserErrors.push(`response:${response.status()}:${response.url()}`); });
  page.on('requestfailed', request => browserErrors.push(`failed:${request.url()}:${request.failure()?.errorText}`));
  await installFixtures(page, h);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/studio');
  await expect.poll(() => h.calls.some(call => call.path === 'me'), { message: `url=${page.url()}; synthetic API requests: ${JSON.stringify(h.calls)}; browser details: ${browserErrors.join(' | ')}` }).toBeTruthy();
  await page.getByRole('button', { name: 'Privacy' }).click();
  const privacy = page.locator('.vx-privacy');
  await expect(privacy.getByRole('heading', { name: 'Privacy & memory' })).toBeVisible();
  await expect(privacy).toHaveAttribute('dir', 'ltr');
  await checkNoHorizontalOverflow(page);
  await waitForScreenSettled(page);
  await page.screenshot({ path: testInfo.outputPath('privacy-en.png'), fullPage: true });

  await privacy.getByLabel('Language').selectOption('fa');
  await expect(privacy).toHaveAttribute('dir', 'rtl');
  await expect(privacy).toHaveAttribute('lang', 'fa');
  await expect(privacy.getByRole('heading', { name: 'حریم خصوصی و حافظه' })).toBeVisible();
  await checkNoHorizontalOverflow(page);
  await waitForScreenSettled(page);
  await page.screenshot({ path: testInfo.outputPath('privacy-fa.png'), fullPage: true });
  await privacy.getByLabel('زبان').selectOption('en');

  const personalization = privacy.locator('.vx-privacy-purpose').filter({ has: page.getByRole('heading', { name: 'Personalization' }) });
  await personalization.getByRole('button', { name: 'Review choice' }).click();
  await expect(personalization.getByRole('button', { name: 'Keep off' })).toBeVisible();
  await expect(personalization.locator('.vx-pill')).toHaveText('Off');
  await personalization.getByRole('button', { name: 'Keep off' }).click();
  await expect(personalization.locator('.vx-pill')).toHaveText('Off');
  await personalization.getByRole('button', { name: 'Review choice' }).click();
  await personalization.getByRole('button', { name: 'Turn on' }).click();
  await expect(personalization.locator('.vx-pill')).toHaveText('On');
  expect(h.calls.filter(c => c.path === 'adaptive/consents/present')).toHaveLength(2);
  expect(h.calls.filter(c => c.path === 'adaptive/consents').map(c => c.body?.state)).toEqual(['declined', 'granted']);

  await privacy.getByRole('button', { name: 'Shared memories' }).click();
  const shared = page.locator('.vx-privacy').last();
  await expect(shared.getByText('Synthetic work note')).toBeVisible();
  await expect(shared.getByText('Synthetic personal note')).toHaveCount(0);
  await checkNoHorizontalOverflow(page);
  await waitForScreenSettled(page);
  await page.screenshot({ path: testInfo.outputPath('shared-en.png'), fullPage: true });
  await page.getByRole('button', { name: 'فارسی' }).last().click();
  await expect(shared).toHaveAttribute('dir', 'rtl');
  await checkNoHorizontalOverflow(page);
  await waitForScreenSettled(page);
  await page.screenshot({ path: testInfo.outputPath('shared-fa.png'), fullPage: true });
  await page.getByRole('button', { name: 'English' }).last().click();

  await shared.getByRole('button', { name: 'Personal' }).click();
  await expect(shared.getByText('Synthetic personal note')).toBeVisible();
  await expect(shared.getByText('Synthetic work note')).toHaveCount(0);
  await shared.getByRole('button', { name: 'Work' }).click();
  await shared.getByRole('checkbox', { name: 'Synthetic Guest' }).check();
  await shared.getByRole('checkbox', { name: 'Fixture Agent' }).check();
  await shared.getByLabel('Note').fill('Synthetic explicitly shared note');
  await shared.getByRole('button', { name: 'Preview exact audience' }).click();
  await expect(shared.getByRole('heading', { name: 'These people will be able to read this note' })).toBeVisible();
  expect(h.calls.filter(c => c.path === 'shared/containers')).toHaveLength(0);
  await shared.getByRole('button', { name: 'Share this note' }).click();
  await expect(shared.getByText('Synthetic explicitly shared note')).toBeVisible();
  const previewIndex = h.calls.findIndex(c => c.path === 'shared/preview');
  const createIndex = h.calls.findIndex(c => c.path === 'shared/containers');
  expect(previewIndex).toBeGreaterThanOrEqual(0);
  expect(createIndex).toBeGreaterThan(previewIndex);
  expect(h.calls[createIndex].body).toMatchObject({ previewToken: 'synthetic-preview-token', text: 'Synthetic explicitly shared note' });

  await page.getByRole('button', { name: 'Back' }).last().click();
  await page.locator('.vx-privacy').getByRole('button', { name: 'Preferences & notification inbox' }).click();
  const experience = page.locator('.vx-privacy').last();
  await expect(page.getByText('Your experience').last()).toBeVisible();
  await expect(experience).toHaveAttribute('dir', 'ltr');
  await checkNoHorizontalOverflow(page);
  await waitForScreenSettled(page);
  await page.screenshot({ path: testInfo.outputPath('experience-en.png'), fullPage: true });
  await page.getByRole('button', { name: 'فارسی' }).last().click();
  await expect(experience).toHaveAttribute('dir', 'rtl');
  await checkNoHorizontalOverflow(page);
  await waitForScreenSettled(page);
  await page.screenshot({ path: testInfo.outputPath('experience-fa.png'), fullPage: true });
  await page.getByRole('button', { name: 'English' }).last().click();
  await experience.getByRole('combobox', { name: 'Agent' }).selectOption(AGENT);
  const replyLength = experience.getByRole('article', { name: 'Reply length preference', exact: true });
  const replyLanguage = experience.getByRole('article', { name: 'Reply language preference', exact: true });
  await expect(experience.locator('.vx-preference-row')).toHaveCount(3);
  await replyLength.getByRole('combobox', { name: 'Reply length', exact: true }).selectOption('detailed');
  await replyLength.getByRole('button', { name: 'Save preference', exact: true }).click();
  await expect.poll(() => h.preferenceValue('work', AGENT, 'response_length')).toBe('detailed');
  await expect(replyLength.getByText('Saved choice: Detailed')).toBeVisible();
  await expect(replyLanguage.getByRole('combobox', { name: 'Reply language', exact: true })).toHaveValue('auto');
  await replyLength.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect.poll(() => h.preferenceValue('work', AGENT, 'response_length')).toBeUndefined();
  await expect(replyLength.getByRole('combobox', { name: 'Reply length', exact: true })).toHaveValue('balanced');
  const resetReplyLength = await replyLength.getByRole('combobox', { name: 'Reply length', exact: true }).inputValue();
  expect(h.preferences[`work:${AGENT}:response_length`].status).toBe('reset');
  const preferenceWrites = h.calls.filter(c => c.path === 'experience/preferences' && c.method === 'PUT');
  expect(preferenceWrites.map(c => c.body)).toMatchObject([
    { agentId: AGENT, space: 'work', action: 'set', setting: { key: 'response_length', value: 'detailed' }, expectedRevision: 1 },
    { agentId: AGENT, space: 'work', action: 'reset', setting: { key: 'response_length', value: 'detailed' }, expectedRevision: 2 },
  ]);
  expect(h.calls.some(c => c.path === 'experience/preferences' && c.method === 'GET' && c.space === 'work')).toBeTruthy();
  await experience.getByRole('button', { name: 'Personal', exact: true }).click();
  await expect(experience.getByRole('combobox', { name: 'Agent', exact: true })).toHaveValue('');
  await expect(replyLength).toHaveCount(0);
  await experience.getByRole('combobox', { name: 'Agent', exact: true }).selectOption(AGENT);
  await expect(replyLength.getByRole('combobox', { name: 'Reply length', exact: true })).toHaveValue('balanced');
  await replyLength.getByRole('combobox', { name: 'Reply length', exact: true }).selectOption('brief');
  await replyLength.getByRole('button', { name: 'Save preference', exact: true }).click();
  await expect.poll(() => h.preferenceValue('personal', AGENT, 'response_length')).toBe('brief');
  await expect(replyLength.getByText('Saved choice: Brief')).toBeVisible();
  await experience.getByRole('button', { name: 'Work', exact: true }).click();
  await expect(experience.getByRole('combobox', { name: 'Agent', exact: true })).toHaveValue('');
  await experience.getByRole('combobox', { name: 'Agent', exact: true }).selectOption(AGENT);
  await expect(replyLength.getByRole('combobox', { name: 'Reply length', exact: true })).toHaveValue('balanced');
  expect(h.preferenceValue('work', AGENT, 'response_length')).toBeUndefined();
  expect(h.preferenceValue('personal', AGENT, 'response_length')).toBe('brief');
  await experience.getByLabel('Enable inbox').check();
  await experience.getByLabel('Selected timezone').fill('Europe/Tallinn');
  await experience.getByRole('button', { name: 'Save notification settings' }).click();
  await expect.poll(() => h.settings.work.inboxEnabled).toBe(true);
  expect(h.calls.some(c => c.path === 'experience/settings' && c.body?.space === 'work' && c.body?.inboxEnabled === true)).toBeTruthy();
  await testInfo.attach('reply-length-after-reset.txt', { body: `Displayed value after successful reset: ${resetReplyLength}\n`, contentType: 'text/plain' });
  expect(resetReplyLength, 'Reset should return the displayed Reply length to Balanced').toBe('balanced');
});


async function checkActionLabelsFit(region: Locator) {
  const geometry = await region.locator('.vx-learning-actions > button').evaluateAll(buttons => buttons.map(button => {
    const bounds = button.getBoundingClientRect();
    const label = document.createRange();
    label.selectNodeContents(button);
    const text = label.getBoundingClientRect();
    return { label: button.textContent, fits: text.top >= bounds.top && text.bottom <= bounds.bottom
      && text.left >= bounds.left && text.right <= bounds.right };
  }));
  expect(geometry).toHaveLength(2);
  for (const action of geometry) expect(action.fits, `Action label must fit inside its button: ${action.label}`).toBe(true);
}

test('learning evidence stays scoped, honest and downloadable in English and Persian', async ({ page }, testInfo) => {
  const h = makeHarness();
  await installFixtures(page, h);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/studio');
  await page.getByRole('button', { name: 'Privacy', exact: true }).click();
  await page.getByRole('button', { name: 'Preferences & notification inbox' }).click();
  const experience = page.locator('.vx-privacy').last();
  const learning = page.getByRole('region', { name: 'Learning evidence', exact: true });
  await expect(learning.getByText('Your Work space')).toBeVisible();
  await expect(learning.locator('dd').first()).toHaveText('12');
  await expect(learning.getByText(/Waiting to process/)).toHaveText('Waiting to process: 2 · Processing failures: 1');
  await expect(learning.getByText('Playback is client reported. Verified task success is unknown.')).toBeVisible();
  await expect(learning.getByText('Average response time: Unavailable')).toBeVisible();
  await expect(learning).not.toContainText('PRIVATE_');
  await checkNoHorizontalOverflow(page);
  await checkActionLabelsFit(learning);
  await learning.screenshot({ path: testInfo.outputPath('learning-en.png') });
  await learning.getByRole('button', { name: 'Refresh measurements', exact: true }).click();
  await expect(learning.locator('dd').first()).toHaveText('13');
  await expect(learning.getByText(/Waiting to process/)).toHaveText('Waiting to process: 0 · Processing failures: 1');
  expect(h.calls.find(c => c.path === 'learning/observations/process')).toMatchObject({ method: 'POST', space: 'work', body: {} });

  await experience.getByRole('button', { name: 'Personal', exact: true }).click();
  await expect(learning.getByText('Your Personal space')).toBeVisible();
  await expect(learning.getByText(/Optional usage analytics is off or unavailable/)).toBeVisible();
  await expect(learning.locator('dd').first()).toHaveText('Unavailable');
  await expect(learning.getByText(/Playback failures were reported by the client/)).toHaveCount(0);
  const downloadPromise = page.waitForEvent('download');
  await learning.getByRole('button', { name: 'Export my learning data' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('vox-learning-personal.json');
  const stream = await download.createReadStream();
  let exported = ''; if (stream) for await (const chunk of stream) exported += chunk.toString();
  expect(JSON.parse(exported)).toMatchObject({ schemaVersion: 1, space: 'personal' });
  expect(h.calls.filter(c => c.path === 'learning/export')).toEqual([expect.objectContaining({ method: 'GET', space: 'personal' })]);
  await testInfo.attach('learning-personal-export.json', { body: exported, contentType: 'application/json' });

  await page.getByRole('button', { name: 'فارسی', exact: true }).click();
  const persian = page.getByRole('region', { name: 'شواهد یادگیری', exact: true });
  await expect(persian).toHaveAttribute('dir', 'rtl');
  await expect(persian).toHaveAttribute('lang', 'fa');
  await expect(persian.getByText('فضای شخصی شما')).toBeVisible();
  await expect(persian.locator('dd').first()).toHaveText('در دسترس نیست');
  await checkNoHorizontalOverflow(page);
  await persian.screenshot({ path: testInfo.outputPath('learning-fa-personal.png') });
  await experience.getByRole('button', { name: 'کاری', exact: true }).click();
  await expect(persian.locator('dd').first()).toHaveText('۱۳');
  await expect(persian.getByText('پخش توسط مرورگر گزارش شده است. موفقیت تأییدشدهٔ کار نامشخص است.')).toBeVisible();
  await checkActionLabelsFit(persian);
  await persian.screenshot({ path: testInfo.outputPath('learning-fa-work.png') });
  const operations = page.getByRole('region', { name: 'عملیات بهبود نرم‌افزار', exact: true });
  await expect(operations.getByText('گزارش روند محلی: در دسترس نیست.')).toBeVisible();
  await expect(operations.getByText(/CI، استقرار، اثر عملیاتی و هزینه: در دسترس نیست/)).toBeVisible();
  await operations.screenshot({ path: testInfo.outputPath('operations-fa.png') });
});
