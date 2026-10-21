import { expect, type Page } from '@playwright/test';

/** Exercise the real shell and sheets; never replace scope through storage or API calls. */
export const activeScreen = (page: Page) => page.locator('.vx-screen:not([inert])');
/** A leaving tab bar can outlive the incoming page. Wait for the whole stage, not just a visible child. */
export async function waitStudioSettled(page: Page) {
  await expect.poll(() => page.evaluate(() => {
    const stage = document.querySelector('.vx-stage');
    const screens = stage?.querySelectorAll<HTMLElement>('.vx-screen');
    if (!stage || stage.hasAttribute('data-busy') || screens?.length !== 1) return false;
    const screen = screens[0];
    if (screen.hasAttribute('inert') || screen.hasAttribute('data-arrive')) return false;
    const style = getComputedStyle(screen);
    const matrix = style.transform === 'none' ? new DOMMatrixReadOnly() : new DOMMatrixReadOnly(style.transform);
    return style.opacity === '1' && style.visibility !== 'hidden' && screen.getBoundingClientRect().width > 0
      && matrix.isIdentity;
  })).toBe(true);
}
export async function closeStudioSheet(page: Page) {
  const dialogs = page.getByRole('dialog');
  if (await dialogs.count()) {
    await page.keyboard.press('Escape');
    await expect(dialogs).toHaveCount(0);
  }
}
export async function openYou(page: Page) {
  await closeStudioSheet(page);
  for (let depth = 0; depth < 8; depth++) {
    await waitStudioSettled(page);
    const screen = activeScreen(page);
    if (await screen.locator('.vx-you').count()) return;
    const main = page.getByRole('navigation', { name: /^(Main|اصلی)$/ });
    if (await screen.getAttribute('data-layer') === 'root') {
      await expect(main).toBeVisible();
      await main.getByRole('button', { name: /^(You|شما)$/ }).click();
      await waitStudioSettled(page);
      await expect(activeScreen(page).locator('.vx-you')).toBeVisible();
      return;
    }
    await screen.locator('.vx-topbar > button').first().click();
    await waitStudioSettled(page);
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
  await waitStudioSettled(page);
  const tab = activeScreen(page).getByRole('tab', { name: space === 'work' ? /^(Work|کاری)$/ : /^(Personal|شخصی)$/ });
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
}
export async function chooseSettingsAgent(page: Page, agentName: string) {
  await waitStudioSettled(page);
  await activeScreen(page).getByRole('button', { name: /^(Agent|عامل|For|برای):/ }).click();
  await page.getByRole('radio').filter({ has: page.getByText(agentName, { exact: true }) }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
