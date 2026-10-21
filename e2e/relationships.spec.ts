import { expect, test, type Page } from '@playwright/test';
import { chooseSettingsAgent, closeStudioSheet, openYou, setStudioLocale, switchStudioSpace } from './helpers/studio-navigation';
import type { LearningPublicView } from '../src/lib/adaptive/personalization/learning/contracts';
import type { PreferenceState } from '../src/lib/adaptive/runtime/contracts';

const ownerId = 77001;
const agent = {
  id: 'fixture-nova', status: 'active', persona: {
    name: 'Nova', role: 'Designer', tagline: 'A thoughtful teammate', backstory: 'Fictional fixture.',
    personality: 'Warm and curious.', communicationStyle: 'Clear', values: ['Craft'], expertise: ['Design'],
    wontDo: '', languages: ['English'], culture: '', presentation: 'neutral', age: '30s', accent: '', voiceBrief: '', avatarHint: '',
  }, look: { hue: 'sky', family: 'drift', features: { cheeks: true, lashes: false, brows: true } },
  locked: true, formingDay: null, isAdmin: false, visibility: 'private', access: [], createdBy: ownerId,
  canEdit: false, canFire: false, canManageAccess: true, liveWeb: false,
};
const members = [
  { telegramId: ownerId, name: 'Fixture Owner', role: 'owner', joinedAt: '2026-01-01T00:00:00.000Z' },
  { telegramId: 77002, name: 'Fixture Teammate', role: 'member', joinedAt: '2026-01-02T00:00:00.000Z' },
];
const memory = {
  id: 'fixture-memory', content: 'Likes a concise design review.', type: 'preference', scope: 'private',
  scopeLabel: 'Private to you', from: 'Fixture Owner', mine: true, at: '2026-10-19T08:00:00.000Z', sensitivity: 'normal',
};
const relation = (space: 'work' | 'personal', externalAvailable: boolean) => ({
  available: false, mode: 'off' as const, disabled: false,
  pausedUntil: undefined, timeZone: 'Europe/Tallinn', quietHours: { start: 22, end: 8 },
  preferences: [{ key: 'brevity', value: space === 'work' ? 'Work-only preference' : 'Personal-only preference' }],
  openSituations: 1, pending: 1, unanswered: 0, space, externalEnabled: false, externalAvailable,
  inbox: [{ id: `${space}-checkin`, text: `CHECKIN_${space.toUpperCase()}_PRIVATE`, createdAt: 1_797_000_000_000, expiresAt: 1_799_000_000_000, status: 'unread' as const }],
  sources: [{ id: `${space}-source`, createdAt: 1_796_000_000_000 }],
});
const experience = (space: 'work' | 'personal') => ({ schemaVersion: 1, revision: 1, space, confirmed: true,
  preferences: [], settings: { revision: 1, timezone: 'Europe/Tallinn', dailyCap: 2, quietStartHour: 21, quietEndHour: 8,
    work: { inboxEnabled: true, proactiveEnabled: true, reminderEnabled: false },
    personal: { inboxEnabled: true, proactiveEnabled: true, reminderEnabled: false } }, inbox: [],
  observations: { available: false, responded: 0, failed: 0, cancelled: 0, total: 0, meanResponseMs: null, verifiedTaskSuccess: null, complete: false },
  capabilities: { personalization: true, productAnalytics: false, proactiveInbox: true, reminders: false, decisions: false },
});
const adaptive = (space: 'work' | 'personal') => ({ schemaVersion: 1, revision: 1, space, scope: 'private_account_profile',
  identity: { accountId: 'fixture-account', personId: 'fixture-person', bindingId: 'fixture-binding', bindingRevision: 1, confirmed: true, verification: 'account_confirmation', adultDeclared: true },
  purposes: [], memories: [], agents: [{ agentId: agent.id, allowed: true, revision: 1 }], explicitMemoryAvailable: true,
});

async function installStudioFixtures(page: Page, externalAvailable = false) {
  let memoryScope = 'private';
  const relationships = { work: relation('work', externalAvailable), personal: relation('personal', externalAvailable) };
  const mutations: Array<{ path: string; method: string; query: string; body: Record<string, unknown> }> = [];
  const reads: Array<{ path: string; query: string }> = [];
  await page.route('**/api/studio/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace('/api/studio/', '');
    const method = request.method();
    const query = url.search;
    const body = request.postDataJSON?.() as Record<string, unknown> | undefined;
    if (method !== 'GET' && body) mutations.push({ path, method, query, body });
    if (method === 'GET') reads.push({ path, query });
    let result: unknown;
    if (path === 'me') result = { member: members[0], org: 'Fixture Studio', bot: 'fixture_bot', features: { avatars: false, voices: false, calls: false, legacyMemorySharing: true } };
    else if (path === 'agents') result = { agents: [agent] };
    else if (path === 'product-pause' && method === 'GET') result = { version: 1, accountId: 'fixture-account',
      space: url.searchParams.get('space') === 'personal' ? 'personal' : 'work', available: false,
      reason: 'store_not_prepared', productPaused: null, useEpoch: null, canPause: false, canResume: false };
    else if (path === `agents/${agent.id}`) result = { agent };
    else if (path === `agents/${agent.id}/memories`) {
      if (method === 'GET') result = { memories: [{ ...memory, scope: memoryScope, scopeLabel: memoryScope === 'private' ? 'Private to you' : 'Shared with Fixture Teammate' }] };
      else { memoryScope = 'shared'; result = { ok: true }; }
    }
    else if (path === `agents/${agent.id}/revoke-memory`) { memoryScope = 'private'; result = { ok: true }; }
    else if (path === `agents/${agent.id}/relationship`) {
      const space = (body?.space ?? new URLSearchParams(query).get('space') ?? 'work') as 'work' | 'personal';
      const state = relationships[space];
      if (method === 'PUT') {
        const action = body?.action;
        if (action === 'pause') { state.disabled = false; state.pausedUntil = String(body?.until); }
        if (action === 'resume') { state.disabled = false; state.pausedUntil = undefined; }
        if (action === 'stop') state.disabled = true;
        if (action === 'forget') { state.preferences = []; state.inbox = []; state.sources = []; state.pending = 0; }
        if (action === 'external' && typeof body?.enabled === 'boolean') state.externalEnabled = body.enabled;
        if (action === 'source-delete') state.sources = state.sources.filter(source => source.id !== body?.sourceId);
        if (action === 'read') state.inbox = state.inbox.map(item => item.id === body?.itemId ? { ...item, status: 'read' as const } : item);
        if (action === 'dismiss') state.inbox = state.inbox.filter(item => item.id !== body?.itemId);
      }
      result = { relationship: structuredClone(state) };
    }
    else if (path === 'experience/preferences' && method === 'GET') {
      const space = url.searchParams.get('space') === 'personal' ? 'personal' : 'work';
      result = { schemaVersion: 1, revision: 1, space, agentId: agent.id, receipt: 'synthetic-preference-projection',
        entries: [
          { setting: { key: 'response_length', value: 'balanced' }, source: 'default', applied: false, explanation: 'default' },
          { setting: { key: 'language', value: 'auto' }, source: 'default', applied: false, explanation: 'default' },
          { setting: { key: 'formatting', value: 'plain' }, source: 'default', applied: false, explanation: 'default' },
        ] } satisfies PreferenceState;
    }
    else if (path === 'experience/preference-learning' && method === 'GET') {
      result = { schemaVersion: 1, version: 'preference-learning-v1', revision: 1,
        space: url.searchParams.get('space') === 'personal' ? 'personal' : 'work', agentId: agent.id,
        available: false, enabled: false, reason: 'unavailable', candidates: [] } satisfies LearningPublicView;
    }
    else if (path === 'experience/preference-learning/cancel' && method === 'POST') result = { cancelled: true };
    else if (path === 'experience' && method === 'GET') result = experience((new URLSearchParams(query).get('space') ?? 'work') as 'work' | 'personal');
    else if (path === 'adaptive' && method === 'GET') result = adaptive((new URLSearchParams(query).get('space') ?? 'work') as 'work' | 'personal');
    else if (path === 'members') result = { people: members, agentAdmins: [] };
    else if (path === 'relationship-observations') result = { mode: 'live', sampledEvents: 4, counts: { turn: 2, sent: 1, feedback: 1 }, feedbackOutcomes: { helpful: 1 }, windowStart: '2026-10-19T07:00:00.000Z', windowEnd: '2026-10-19T09:00:00.000Z', scope: 'Counts only; no conversation content.' };
    else result = { error: `Unhandled test fixture route: ${method} ${path}` };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(result) });
  });
  return { mutations, reads };
}

async function enterExperience(page: Page) {
  await page.goto('/studio');
  await openYou(page);
  await page.getByRole('button', { name: 'Preferences', exact: true }).click();
  await chooseSettingsAgent(page, 'Nova');
  await expect(page.getByText('Suggestion learning is unavailable here. Ordinary explicit preferences still work.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Enable suggestions', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: /^Staying in touch/ }).click();
  await expect(page.getByRole('heading', { name: 'Staying in touch' })).toBeVisible();
}

async function personalRelationship(page: Page) {
  await closeStudioSheet(page);
  const personalSettings = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/experience') && new URL(response.url()).searchParams.get('space') === 'personal');
  await switchStudioSpace(page, 'personal');
  await personalSettings;
  await chooseSettingsAgent(page, 'Nova');
  await page.getByRole('button', { name: /^Staying in touch/ }).click();
}

test('scoped check-ins clear on Work/Personal switch, localize, and support inbox/source controls', async ({ page }) => {
  const { mutations, reads } = await installStudioFixtures(page);
  await enterExperience(page);
  const workCheckin = 'CHECKIN_WORK_PRIVATE';
  const personalCheckin = 'CHECKIN_PERSONAL_PRIVATE';
  await expect(page.getByText('Work-only preference')).toBeVisible();
  await expect(page.getByText(workCheckin)).toBeVisible();
  await expect.poll(() => reads.some(read => read.path.endsWith('/relationship') && read.query === '?space=work')).toBe(true);

  await personalRelationship(page);
  await expect(page.getByText(workCheckin)).not.toBeVisible();
  await expect(page.getByText('Personal-only preference')).toBeVisible();
  await expect(page.getByText(personalCheckin)).toBeVisible();
  await expect.poll(() => reads.some(read => read.path.endsWith('/relationship') && read.query === '?space=personal')).toBe(true);

  await setStudioLocale(page, 'fa');
  await page.getByRole('button', { name: 'ترجیح‌ها', exact: true }).click();
  await chooseSettingsAgent(page, 'Nova');
  await page.getByRole('button', { name: /^در ارتباط ماندن/ }).click();
  await expect(page.getByRole('region', { name: 'در ارتباط ماندن' })).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('tab', { name: 'مکث ۷ روزه' })).toBeVisible();
  await page.getByRole('button', { name: 'علامت‌گذاری به‌عنوان خوانده‌شده' }).focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => mutations.some(m => m.body.action === 'read' && m.body.space === 'personal' && m.body.itemId === 'personal-checkin')).toBe(true);
  await expect(page.getByRole('button', { name: 'علامت‌گذاری به‌عنوان خوانده‌شده' })).not.toBeVisible();
  await page.getByRole('region', { name: 'در ارتباط ماندن' }).getByRole('button', { name: 'بستن', exact: true }).click();
  await expect(page.getByText(personalCheckin)).not.toBeVisible();
  await page.getByRole('button', { name: 'حذف منبع' }).click();
  await expect.poll(() => mutations.some(m => m.body.action === 'source-delete' && m.body.space === 'personal' && m.body.sourceId === 'personal-source')).toBe(true);
  expect(mutations.filter(m => m.path.endsWith('/relationship')).every(m => m.body.space === 'personal')).toBe(true);
});

test('external alerts stay off and disabled without the separate permission', async ({ page }) => {
  await installStudioFixtures(page);
  await enterExperience(page);
  const alerts = page.getByRole('switch', { name: 'Generic Telegram alerts' });
  await expect(alerts).not.toBeChecked();
  await expect(alerts).toBeDisabled();
  await expect(page.getByText(/never include conversation content/i)).toBeVisible();

  const width = await page.evaluate(() => ({ viewport: window.innerWidth, document: document.documentElement.scrollWidth }));
  expect(width.document).toBeLessThanOrEqual(width.viewport);
});

test('permitted generic alert can be enabled by keyboard in the selected scope', async ({ page }) => {
  const { mutations } = await installStudioFixtures(page, true);
  await enterExperience(page);
  await personalRelationship(page);
  const alerts = page.getByRole('switch', { name: 'Generic Telegram alerts' });
  await expect(alerts).toBeEnabled();
  await alerts.focus();
  await page.keyboard.press('Space');
  await expect(alerts).toBeChecked();
  await expect.poll(() => mutations.some(m => m.body.action === 'external' && m.body.enabled === true && m.body.space === 'personal')).toBe(true);
});

test('pause, stop and forget remain available after feature eligibility is withdrawn', async ({ page }) => {
  const { mutations } = await installStudioFixtures(page);
  await enterExperience(page);
  // This fixture models an existing relationship whose current feature gate is unavailable.
  await page.getByRole('tab', { name: 'Off', exact: true }).click();
  await expect.poll(() => mutations.some(m => m.body.action === 'stop' && m.body.space === 'work')).toBe(true);
  await page.getByRole('tab', { name: 'Pause 7 days', exact: true }).click();
  await expect.poll(() => mutations.some(m => m.body.action === 'pause' && m.body.space === 'work')).toBe(true);
  await page.getByRole('button', { name: 'Forget relationship context' }).click();
  await expect(page.getByRole('group', { name: 'Forget relationship confirmation' })).toBeVisible();
  await page.getByRole('button', { name: 'Clear context' }).click();
  await expect.poll(() => mutations.some(m => m.body.action === 'forget' && m.body.space === 'work')).toBe(true);
});

test('legacy memory sharing and admin observations remain separate from private relationship content', async ({ page }) => {
  const { mutations } = await installStudioFixtures(page);
  await page.goto('/studio');
  await page.getByRole('button', { name: 'Nova, Designer' }).click();
  await page.getByRole('button', { name: 'Memories', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'What Nova remembers' })).toBeVisible();
  await expect(page.getByText(memory.content)).toBeVisible();
  await page.getByRole('button', { name: 'Memory options', exact: true }).click();
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Fixture Teammate', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Fixture Teammate', exact: true })).toBeChecked();
  await page.getByRole('button', { name: 'Share with selected' }).click();
  await expect.poll(() => mutations.find(m => m.path.endsWith('/memories') && m.method === 'PUT')?.body).toEqual({ memoryId: memory.id, recipients: [77002] });
  await expect(page.getByRole('button', { name: 'Stop sharing' })).toBeEnabled();
  await page.getByRole('button', { name: 'Stop sharing' }).click();
  await expect.poll(() => mutations.find(m => m.path.endsWith('/revoke-memory'))?.body).toEqual({ memoryId: memory.id });

  await openYou(page);
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Org', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Conversation activity' })).toBeVisible();
  await expect(page.getByText('Helpful check-ins', { exact: true })).toBeVisible();
  await expect(page.getByText(/Likes a concise design review/)).not.toBeVisible();
});
