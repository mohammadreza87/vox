import { expect, type Page } from '@playwright/test';

/** Exercise the real shell and sheets; never replace scope through storage or API calls. */
export const activeScreen = (page: Page) => page.locator('.vx-screen:not([inert])');
export async function closeStudioSheet(page: Page) {
  const dialogs = page.getByRole('dialog');
  if (await dialogs.count()) {
    await page.keyboard.press('Escape');
    await expect(dialogs).toHaveCount(0);
  }
}
export async function openYou(page: Page) {
  await closeStudioSheet(page);
  await expect(activeScreen(page)).toBeVisible();
  await expect(page.locator('[data-busy]')).toHaveCount(0);
  for (let depth = 0; depth < 8; depth++) {
    const screen = activeScreen(page);
    if (await screen.locator('.vx-you').count()) return;
    const main = page.getByRole('navigation', { name: /^(Main|اصلی)$/ });
    if (await main.isVisible()) {
      await main.getByRole('button', { name: /^(You|شما)$/ }).click();
      await expect(activeScreen(page).locator('.vx-you')).toBeVisible();
      return;
    }
    await screen.locator('.vx-topbar > button').first().click();
    await expect(page.locator('[data-busy]')).toHaveCount(0);
  }
  throw new Error('Could not return to You through the visible navigation stack');
}
/** Locale is global. Returns on You so callers deliberately re-enter their target screen. */
export async function setStudioLocale(page: Page, locale: 'en' | 'fa') {
  await openYou(page);
  await activeScreen(page).getByRole('button', { name: /^(Language|زبان)/ }).click();
  await page.getByRole('radio', { name: locale === 'fa' ? 'فارسی' : 'English', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(activeScreen(page).locator('.vx-you')).toHaveAttribute('lang', locale);
}
export async function switchStudioSpace(page: Page, space: 'work' | 'personal') {
  const tab = activeScreen(page).getByRole('tab', { name: space === 'work' ? /^(Work|کاری)$/ : /^(Personal|شخصی)$/ });
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
}
export async function chooseSettingsAgent(page: Page, agentName: string) {
  await activeScreen(page).getByRole('button', { name: /^(Agent|عامل|For|برای):/ }).click();
  await page.getByRole('radio').filter({ has: page.getByText(agentName, { exact: true }) }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
