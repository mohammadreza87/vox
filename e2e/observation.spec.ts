import { expect, test, type Page } from '@playwright/test';
import { openYou, setStudioLocale } from './helpers/studio-navigation';
// Author regression only: compiled Studio UI with synthetic HTTP responses.
// Real signed handler/canonical FILE evidence is in learning-integration.test.ts.
const PERSON = 780001, AGENT = 'observation-fixture-agent';
const agent = { id: AGENT, status: 'active', persona: { name: 'Observation Fixture', role: 'Synthetic QA', tagline: 'Test only', backstory: '', personality: '', communicationStyle: '', values: [], expertise: [], wontDo: '', languages: ['en', 'fa'], culture: '', presentation: 'neutral', age: 'adult', accent: '', voiceBrief: '', avatarHint: '' }, look: { hue: 'ash', family: 'drift', features: { cheeks: false, lashes: false, brows: false } }, locked: true, formingDay: null, isAdmin: true, visibility: 'private', access: [PERSON], createdBy: PERSON, canEdit: false, canFire: false, canManageAccess: false, liveWeb: false };
async function fixtures(page: Page, correctionFailure = false) {
  const events: Record<string, unknown>[] = [], corrections: Record<string, unknown>[] = [], exposures: Record<string, unknown>[] = [];
  let visibleAtReport = false, turn = 0, noteText = 'PRIVATE_ORIGINAL_CANARY', noteRevision = 1;
  const snapshot = (space = 'work') => ({ schemaVersion: 1, identity: { accountId: 'synthetic-account', personId: 'synthetic-person', bindingId: 'synthetic-binding', bindingRevision: 1, confirmed: true, verification: 'account_confirmation', adultDeclared: true, declaredJurisdiction: 'EE', bindingExpiresAt: Date.now() + 86400000 }, space, revision: noteRevision + 1, purposes: [{ purpose: 'optional.product_analytics', state: 'granted', available: true, revision: 1, notice: { title: 'Optional analytics', body: 'Synthetic', locale: 'en' } }], memories: space === 'work' ? [{ id: 'synthetic-note', text: noteText, revision: noteRevision, createdAt: 1, expiresAt: Date.now() + 86400000 }] : [], agents: [], explicitMemoryAvailable: true, memoryCorrectionAvailable: true, explicitMemoryValidUntil: Date.now() + 86400000, scope: 'private_account_profile' });
  await page.route('**/*', route => new URL(route.request().url()).origin === 'http://127.0.0.1:3105' ? route.continue() : route.abort());
  await page.route('https://telegram.org/js/telegram-web-app.js', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.Telegram={WebApp:{initData:"synthetic-session",ready(){},expand(){},setHeaderColor(){},setBackgroundColor(){},disableVerticalSwipes(){}}};' }));
  await page.route('**/api/**', async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname.replace('/api/studio/', '');
    const body = req.postData() ? req.postDataJSON() : undefined; let data: unknown = {};
    if (path === 'me') data = { member: { telegramId: PERSON, name: 'Synthetic Owner', role: 'owner', joinedAt: '' }, org: 'Synthetic Org', bot: 'fixturebot', features: { avatars: false, voices: false, calls: false } };
    else if (path === 'agents') data = { agents: [agent] };
    else if (path === `agents/${AGENT}`) data = { agent };
    else if (path === 'product-pause') data = { version: 1, accountId: 'synthetic-account', space: url.searchParams.get('space') ?? 'work', available: true, productPaused: false, useEpoch: 0, commandSeq: 0, canPause: true, canResume: false };
    else if (path === 'conversation') data = { reply: 'PRIVATE_REPLY_CANARY', turnId: `accepted-turn-${++turn}`, responsePresentation: { density: 'compact', receipt: turn.toString(16).padStart(64, '0') } };
    else if (path === 'learning/events') {
      events.push(body);
      if (body.outcome === 'text_rendered') visibleAtReport = await page.locator('[data-response-density="compact"]').last().evaluate(el => !!el.textContent?.trim() && getComputedStyle(el).visibility !== 'hidden' && el.getBoundingClientRect().width > 0);
      data = { recorded: true, duplicate: false };
    } else if (path === 'experiments/exposure') { exposures.push(body); data = { recorded: true }; }
    else if (path === 'learning/correction-authority') data = { policyReceipt: 'a'.repeat(64) };
    else if (path === 'learning/corrections') { corrections.push(body); data = { recorded: true, duplicate: false }; }
    else if (path === 'adaptive') data = snapshot(url.searchParams.get('space') ?? 'work');
    else if (path === 'adaptive/memories/synthetic-note' && req.method() === 'PUT') {
      if (correctionFailure) return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"PRIVATE_FAILURE_CANARY"}' });
      noteText = body.text; noteRevision++; data = snapshot(body.space);
    } else return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"synthetic_unavailable"}' });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
  });
  return { events, corrections, exposures, visible: () => visibleAtReport };
}
async function openChat(page: Page) {
  await page.goto('/studio'); await page.getByRole('button', { name: 'Observation Fixture, Synthetic QA' }).click(); await page.getByRole('button', { name: 'Chat', exact: true }).click();
}
test('actual visible committed text reports once with applied presentation and distinct explicit task feedback', async ({ page }) => {
  const f = await fixtures(page); await openChat(page);
  await page.getByLabel('Message', { exact: true }).fill('PRIVATE_QUESTION_CANARY'); await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator('[data-response-density="compact"]')).toHaveText('PRIVATE_REPLY_CANARY');
  await expect.poll(() => f.events.filter(e => e.outcome === 'text_rendered').length).toBe(1);
  await expect.poll(() => f.exposures.length).toBe(1); expect(f.visible()).toBe(true);
  expect(f.events[0]).toMatchObject({ agentId: AGENT, space: 'work', turnId: 'accepted-turn-1', outcome: 'text_rendered', durationMs: expect.any(Number) });
  expect(f.events.some(e => e.outcome === 'task_succeeded')).toBe(false);
  await page.getByRole('button', { name: 'Yes', exact: true }).click(); await expect.poll(() => f.events.length).toBe(2);
  expect(f.events[1].outcome).toBe('task_succeeded'); expect(JSON.stringify(f.events)).not.toContain('PRIVATE_');
  await page.getByRole('button', { name: 'Chat options', exact: true }).click();
  await page.getByRole('dialog', { name: 'Chat options' }).getByRole('tab', { name: 'Personal', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0); await expect(page.getByRole('log')).toBeEmpty();
  await page.waitForTimeout(60); expect(f.events).toHaveLength(2);
});
test('hidden committed output is not reported until actually visible', async ({ page }) => {
  const f = await fixtures(page); await openChat(page); const style = await page.addStyleTag({ content: '[role="log"] { visibility: hidden !important; }' });
  await page.getByLabel('Message', { exact: true }).fill('Synthetic request'); await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator('[data-response-density="compact"]')).toHaveText('PRIVATE_REPLY_CANARY'); await page.waitForTimeout(80); expect(f.events).toHaveLength(0); expect(f.exposures).toHaveLength(0);
  await style.evaluate(el => el.remove()); await page.evaluate(() => window.dispatchEvent(new Event('scroll')));
  await expect.poll(() => f.events.length).toBe(1); expect(f.visible()).toBe(true);
});
for (const locale of ['en', 'fa'] as const) for (const failure of [false, true]) test(`correction ${failure ? 'unconfirmed' : 'saved'} ${locale} produces only fixed feedback metadata`, async ({ page }) => {
  const f = await fixtures(page, failure); await page.goto('/studio'); await openYou(page);
  if (locale === 'fa') await setStudioLocale(page, 'fa');
  const fa = locale === 'fa'; await page.getByRole('button', { name: /PRIVATE_ORIGINAL_CANARY/ }).click();
  await page.getByRole('button', { name: fa ? 'ویرایش یادداشت' : 'Edit note', exact: true }).click();
  await page.getByLabel(fa ? 'یادداشت اصلاح‌شده' : 'Corrected note', { exact: true }).fill('PRIVATE_CORRECTION_CANARY');
  await page.getByRole('button', { name: fa ? 'بررسی اصلاح' : 'Review correction', exact: true }).click();
  await page.getByRole('button', { name: fa ? 'ذخیرهٔ اصلاح' : 'Save correction', exact: true }).click();
  await expect.poll(() => f.corrections.length).toBe(1);
  expect(f.corrections[0]).toMatchObject({ version: 1, space: 'work', eventId: expect.any(String), policyReceipt: 'a'.repeat(64), outcome: failure ? 'correction_client_unconfirmed' : 'correction_client_saved' });
  expect(JSON.stringify(f.corrections)).not.toMatch(/PRIVATE_|note|text|memoryId/);
  if (failure) await expect(page.getByRole('region', { name: fa ? 'اصلاح یادداشت خصوصی' : 'Correct private note' }).getByRole('alert')).not.toContainText('PRIVATE_FAILURE_CANARY');
});
