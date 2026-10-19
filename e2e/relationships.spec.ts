import { expect, test, type Page } from '@playwright/test';

const ownerId = 77001;
const relationship = {
  available: true, mode: 'live' as const, disabled: false, timeZone: 'Europe/Tallinn',
  quietHours: { start: 22, end: 8 },
  preferences: [{ key: 'brevity', value: 'Prefers concise replies' }],
  openSituations: 1, pending: 0, unanswered: 0,
};
const agent = {
  id: 'fixture-nova', status: 'active', persona: {
    name: 'Nova', role: 'Designer', tagline: 'A thoughtful teammate', backstory: 'Fictional fixture.',
    personality: 'Warm and curious.', communicationStyle: 'Clear', values: ['Craft'], expertise: ['Design'],
    wontDo: '', languages: ['English'], culture: '', presentation: 'neutral', age: '30s', accent: '',
    voiceBrief: '', avatarHint: '',
  },
  look: { hue: 'sky', family: 'drift', features: { cheeks: true, lashes: false, brows: true } },
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

async function installStudioFixtures(page: Page) {
  let relationshipState = { ...relationship };
  let memoryScope = 'private';
  const mutations: Array<{ path: string; method: string; body: Record<string, unknown> }> = [];
  await page.route('**/api/studio/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/api/studio/', '');
    const method = request.method();
    const body = request.postDataJSON?.() as Record<string, unknown> | undefined;
    if (method !== 'GET' && body) mutations.push({ path, method, body });
    let result: unknown;
    if (path === 'me') result = { member: members[0], org: 'Fixture Studio', bot: 'fixture_bot', features: { avatars: false, voices: false, calls: false } };
    else if (path === 'agents') result = { agents: [agent] };
    else if (path === `agents/${agent.id}`) result = { agent };
    else if (path === `agents/${agent.id}/memories`) {
      if (method === 'GET') result = { memories: [{ ...memory, scope: memoryScope, scopeLabel: memoryScope === 'private' ? 'Private to you' : 'Shared with Fixture Teammate' }] };
      else { memoryScope = 'shared'; result = { ok: true }; }
    }
    else if (path === `agents/${agent.id}/revoke-memory`) { memoryScope = 'private'; result = { ok: true }; }
    else if (path === `agents/${agent.id}/relationship`) {
      if (method === 'PUT') {
        const action = body?.action;
        if (action === 'pause') relationshipState = { ...relationshipState, disabled: false, pausedUntil: String(body?.until) };
        if (action === 'resume') relationshipState = { ...relationshipState, disabled: false, pausedUntil: undefined };
        if (action === 'configure') relationshipState = { ...relationshipState, timeZone: String(body?.timeZone), quietHours: body?.quietHours as { start: number; end: number } };
      }
      result = { relationship: relationshipState };
    }
    else if (path === 'members') result = { people: members, agentAdmins: [] };
    else if (path === 'relationship-observations') result = { mode: 'live', sampledEvents: 3, counts: { turn: 2, sent: 1 }, windowStart: '2026-10-19T07:00:00.000Z', windowEnd: '2026-10-19T09:00:00.000Z', scope: 'Counts only; no conversation content.' };
    else result = { error: `Unhandled test fixture route: ${method} ${path}` };
    await route.fulfill({ status: path.includes('unhandled') ? 404 : 200, contentType: 'application/json', body: JSON.stringify(result) });
  });
  return mutations;
}

test('relationship settings and memory sharing stay clear on desktop and mobile', async ({ page }, testInfo) => {
  const mutations = await installStudioFixtures(page);
  await page.goto('/studio');

  await page.getByRole('button', { name: 'Nova, Designer' }).click();
  await page.getByRole('button', { name: 'Memories', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'What Nova remembers' })).toBeVisible();
  await expect(page.getByText('Prefers concise replies')).toBeVisible();

  await page.getByRole('button', { name: 'Pause for 7 days' }).click();
  await expect(page.getByText(/Follow-ups are paused until/)).toBeVisible();
  await expect.poll(() => mutations.filter(m => m.path.endsWith('/relationship') && m.body.action === 'pause')).toHaveLength(1);
  await page.getByRole('button', { name: 'Resume follow-ups' }).click();
  await expect(page.getByText('Nova can follow up when there’s something useful to share.')).toBeVisible();
  await expect.poll(() => mutations.filter(m => m.path.endsWith('/relationship') && m.body.action === 'resume')).toHaveLength(1);

  await page.getByLabel('Your time zone').fill('America/Toronto');
  await page.getByLabel('Quiet hours start').fill('21:00');
  await page.getByRole('button', { name: 'Save quiet hours' }).click();
  await expect.poll(() => mutations.find(m => m.body.action === 'configure')?.body).toMatchObject({
    action: 'configure', timeZone: 'America/Toronto', quietHours: { start: 21, end: 8 },
  });

  await page.getByRole('button', { name: 'Share', exact: true }).click();
  await page.getByLabel('Fixture Teammate').check();
  await page.getByRole('button', { name: 'Share with selected' }).click();
  await expect.poll(() => mutations.find(m => m.path.endsWith('/memories') && m.method === 'PUT')?.body).toEqual({ memoryId: memory.id, recipients: [77002] });
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop sharing' })).toBeVisible();
  await page.getByRole('button', { name: 'Stop sharing' }).click();
  await expect.poll(() => mutations.find(m => m.path.endsWith('/revoke-memory'))?.body).toEqual({ memoryId: memory.id });

  const width = await page.evaluate(() => ({ viewport: window.innerWidth, document: document.documentElement.scrollWidth }));
  expect(width.document).toBeLessThanOrEqual(width.viewport);
  await page.getByRole('heading', { name: 'Staying in touch' }).scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  await page.screenshot({ path: `/tmp/vox-relationship-${testInfo.project.name.replaceAll(' ', '-').toLowerCase()}.png`, fullPage: true });

  await page.getByRole('button', { name: 'Nova', exact: true }).click();
  await page.getByRole('button', { name: 'Agents', exact: true }).click();
  await page.getByRole('button', { name: 'Org', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Conversation activity' })).toBeVisible();
  await expect(page.getByText('Interactions observed')).toBeVisible();
  await expect(page.getByText('Check-ins delivered')).toBeVisible();
  await expect(page.getByText(/Personal messages and memories stay private/)).toBeVisible();
  await expect(page.getByText(/Likes a concise design review/)).not.toBeVisible();
});
