import { test, expect } from '@playwright/test';

/** Browser rendering only. All APIs intercepted with synthetic data. This does
 * not establish Telegram authentication, OAuth, real provider or device proof. */
test('Connections fits mobile shell, preserves zero grants, and supports Persian RTL', async ({ page }) => {
  const mutations: string[] = [];
  await page.route('**/api/studio/**', async route => {
    const url = new URL(route.request().url());
    if (route.request().method() !== 'GET') mutations.push(url.pathname);
    if (url.pathname.endsWith('/me')) return route.fulfill({ json: { member: { telegramId: 101, name: 'Demo owner', role: 'owner' }, org: 'Vox demo', bot: 'demo_bot', features: { avatars: false, voices: false, calls: false } } });
    if (url.pathname.endsWith('/agents')) return route.fulfill({ json: { agents: [] } });
    if (url.pathname.endsWith('/adaptive')) return route.fulfill({ status: 503, json: { error: 'fixture_not_needed' } });
    if (url.pathname.endsWith('/connections/workflows')) return route.fulfill({ json: { workflows: [], occurrences: [], subscriptions: [] } });
    if (url.pathname.endsWith('/connections/workflow-choices')) return route.fulfill({ json: { choices: [] } });
    if (url.pathname.endsWith('/connections')) return route.fulfill({ json: {
      schemaVersion: 1, enabled: true, maxGrantExpiryAt: Date.now() + 3_600_000,
      scope: { tenantId: 'demo', spaceId: url.searchParams.get('space'), spaceKind: url.searchParams.get('space'), containerId: 'private', audiencePersonIds: ['demo-owner'], audienceRevision: '1' },
      providers: [{ id: 'notion', name: 'Notion', description: 'Read selected pages · Append reviewed content', setup: 'oauth', availability: 'ready', reason: '', tools: [] },
        { id: 'gmail', name: 'Gmail', description: 'Read selected messages · Prepare a draft', setup: 'oauth', availability: 'setup_required', reason: 'OAuth app registration and account verification are required.', tools: [] }],
      connections: [{ id: 'demo-notion', providerId: 'notion', displayLabel: 'Notion · Demo workspace', revision: 2, lifecycle: 'connected', health: 'healthy', checkedAt: Date.now(), revocationEpoch: 0 }],
      grants: [], operations: [], agents: [{ id: 'demo-agent', name: 'Knowledge assistant' }],
    } });
    return route.fulfill({ status: 404, json: { error: 'fixture_route_unavailable' } });
  });
  await page.goto('/studio');
  await page.getByRole('button', { name: 'Privacy', exact: true }).click();
  await page.getByRole('button', { name: 'Connections & agent access' }).click();
  await expect(page.getByRole('heading', { name: 'Connections', exact: true })).toBeVisible();
  await expect(page.getByText('No agent access', { exact: true })).toBeVisible();
  const screen = page.locator('section.vx-privacy').filter({ has: page.getByRole('heading', { name: /^(Connections|اتصال‌ها)$/ }) });
  await expect(page.locator('section.vx-privacy')).toHaveCount(1);
  await expect(screen.locator('..')).toHaveCSS('opacity', '1');
  expect(await screen.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: 'docs/connections/evidence/ui-connections-en.png', fullPage: true });
  await screen.getByRole('combobox', { name: 'Language', exact: true }).selectOption('fa');
  await expect(screen).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { name: 'اتصال‌ها', exact: true })).toBeVisible();
  await expect(page.getByText('بدون دسترسی عامل', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'docs/connections/evidence/ui-connections-fa.png', fullPage: true });
  expect(mutations).toEqual([]);
});
