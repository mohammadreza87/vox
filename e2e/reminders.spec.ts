import { expect, test } from '@playwright/test';
import { closeStudioSheet, setStudioLocale } from './helpers/studio-navigation';
/** Real browser/product source, synthetic signed-API boundary. This is not a Telegram device/send qualification. */
test('opaque notification opens its own personal reminder, with explicit EN/FA snooze and channel controls', async ({ page }, info) => {
  const calls: { path: string; body?: Record<string, unknown> }[] = [];
  let enabled = false, presented = false;
  const settings = { revision: 1, timezone: 'Europe/Tallinn', dailyCap: 2, quietStartHour: 21, quietEndHour: 8, work: { inboxEnabled: true, reminderEnabled: true, proactiveEnabled: false }, personal: { inboxEnabled: true, reminderEnabled: true, proactiveEnabled: false } };
  const snapshot = (space: string) => ({ schemaVersion: 1, revision: 1, space, confirmed: true, settings, preferences: [], inbox: [],
    reminders: space === 'personal' ? [{ id: 'reminder-personal', kind: 'requested_reminder', category: 'reminder', space, agentId: 'fixture-agent', label: 'SYNTHETIC_PERSONAL_REMINDER', dueAt: Date.now(), delivery: { state: 'unknown', generation: 1, channelRevision: 1, endpointId: 'fixture', quietHours: 'respect' } }] : [],
    reminderTelegram: { available: true, connected: true, enabled, ...(presented ? { disclosure: { version: 'generic-reminders-30d-v1', receipt: 'synthetic-receipt', expiresAt: Date.now() + 600000 } } : {}) }, observations: { available: false, total: 0 }, capabilities: { personalization: false, productAnalytics: false, reminders: true, proactiveInbox: false, decisions: false } });
  await page.route('**/*', route => new URL(route.request().url()).origin === 'http://127.0.0.1:3106' ? route.continue() : route.abort());
  await page.route('https://telegram.org/js/telegram-web-app.js', route => route.fulfill({ contentType: 'application/javascript', body: 'window.Telegram={WebApp:{initData:"synthetic",ready(){},expand(){},setHeaderColor(){},setBackgroundColor(){},disableVerticalSwipes(){}}};' }));
  await page.route('**/api/studio/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname.slice('/api/studio/'.length);
    let body: Record<string, unknown> | undefined; try { body = request.postDataJSON(); } catch {}
    calls.push({ path, body });
    const space = String(body?.space ?? url.searchParams.get('space') ?? 'work');
    let value: unknown = {};
    if (path === 'me') value = { member: { telegramId: 123, name: 'Synthetic', role: 'member', joinedAt: '' }, org: 'Synthetic', bot: 'fixture', features: { calls: false, avatars: false, voices: false } };
    else if (path === 'product-pause' && request.method() === 'GET') value = { version: 1, accountId: 'telegram-account:123',
      space: url.searchParams.get('space') === 'personal' ? 'personal' : 'work', available: false,
      reason: 'store_not_prepared', productPaused: null, useEpoch: null, canPause: false, canResume: false };
    else if (path === 'adaptive') value = { schemaVersion: 1, revision: 1, space, scope: 'private_account_profile',
      identity: { accountId: 'telegram-account:123', personId: 'synthetic-person', bindingId: 'synthetic-binding', bindingRevision: 1, confirmed: true, verification: 'account_confirmation', adultDeclared: true, declaredJurisdiction: 'EE' },
      purposes: [], memories: [], agents: [], explicitMemoryAvailable: true };
    else if (path === 'agents') value = { agents: [{ id: 'fixture-agent', status: 'active', persona: { name: 'Fixture Agent', role: 'Synthetic', tagline: '', languages: ['en', 'fa'] }, look: { hue: 'ash', family: 'drift', features: {} }, visibility: 'private', access: [123], createdBy: 123 }] };
    else if (path === 'experience/reminders/reminder-personal') value = { space: 'personal' };
    else if (path === 'experience/reminder-channel/present') { presented = true; value = snapshot(space); }
    else if (path === 'experience/reminder-channel') { enabled = body?.enabled === true; presented = false; value = snapshot(space); }
    else if (path.startsWith('experience')) value = snapshot(space);
    else if (path === 'learning') value = { available: false, space };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) });
  });
  await page.goto('/studio?notification=reminder-personal');
  await expect(page.getByText('SYNTHETIC_PERSONAL_REMINDER')).toBeVisible();
  await expect(page.locator('#reminder-reminder-personal')).toHaveAttribute('aria-current', 'true');
  await expect(page.getByText('Delivery is uncertain.', { exact: false })).toBeVisible();
  expect(calls.filter(c => c.path === 'experience/reminder-channel')).toHaveLength(0);
  await page.getByRole('button', { name: /^Telegram alerts/ }).click();
  await page.getByRole('button', { name: 'Review Telegram reminder choice' }).click();
  expect(calls.filter(c => c.path === 'experience/reminder-channel')).toHaveLength(0);
  await page.getByRole('button', { name: 'Allow generic alerts for up to 30 days' }).click();
  await page.getByRole('button', { name: /^Telegram alerts/ }).click();
  await expect(page.getByRole('button', { name: 'Turn Telegram reminders off' })).toBeVisible();
  expect(calls.find(c => c.path === 'experience/reminder-channel')?.body).toMatchObject({ space: 'personal', enabled: true });
  await page.screenshot({ path: info.outputPath('reminders-en.png'), fullPage: true });
  await closeStudioSheet(page);
  await setStudioLocale(page, 'fa');
  await page.getByRole('button', { name: 'یادآورها', exact: true }).click();
  await expect(page.locator('.vx-settings-page')).toHaveAttribute('dir', 'rtl');
  await page.getByRole('button', { name: /SYNTHETIC_PERSONAL_REMINDER/ }).click();
  await page.getByRole('button', { name: 'تعویق ۱۵ دقیقه' }).click();
  expect(calls.find(c => c.path === 'experience/reminder-action')?.body).toMatchObject({ space: 'personal', itemId: 'reminder-personal', action: 'snooze' });
  await expect(page.getByRole('button', { name: 'این یادآور را بررسی کردم' })).toBeVisible();
  await page.screenshot({ path: info.outputPath('reminders-fa.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await expect(page).toHaveURL(/\/studio$/);
});
