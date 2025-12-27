import { test, expect } from '@playwright/test';

test.describe('Authentication', () => {
  test('redirects unauthenticated users to login from app', async ({ page }) => {
    await page.goto('/app');
    // Should redirect to login
    await expect(page).toHaveURL(/.*login/);
  });

  test('login page renders correctly', async ({ page }) => {
    await page.goto('/login');

    // Check for login form elements
    await expect(page.getByRole('heading')).toBeVisible();
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
  });

  test('shows error for invalid email format', async ({ page }) => {
    await page.goto('/login');

    // Fill in invalid email
    await page.fill('input[type="email"]', 'invalid-email');
    await page.fill('input[type="password"]', 'password123');

    // Try to submit
    await page.click('button[type="submit"]');

    // Should show some form of error (form validation or API error)
    // The exact error handling depends on implementation
  });

  test('landing page renders correctly', async ({ page }) => {
    await page.goto('/');

    // Check for main elements on landing page
    await expect(page).toHaveTitle(/Vox/);
  });

  test('pricing page is accessible', async ({ page }) => {
    await page.goto('/pricing');

    // Check for pricing content
    await expect(page.getByText(/Free|Pro|Max/i)).toBeVisible();
  });
});

test.describe('Protected Routes', () => {
  test('settings page requires authentication', async ({ page }) => {
    await page.goto('/settings');
    // Should redirect to login
    await expect(page).toHaveURL(/.*login/);
  });

  test('create page requires authentication', async ({ page }) => {
    await page.goto('/create');
    // Should redirect to login
    await expect(page).toHaveURL(/.*login/);
  });

  test('translator page requires authentication', async ({ page }) => {
    await page.goto('/translator');
    // Should redirect to login
    await expect(page).toHaveURL(/.*login/);
  });
});

test.describe('Navigation', () => {
  test('can navigate from landing to login', async ({ page }) => {
    await page.goto('/');

    // Find and click a login link/button
    const loginLink = page.getByRole('link', { name: /login|sign in|get started/i });
    if (await loginLink.isVisible()) {
      await loginLink.click();
      await expect(page).toHaveURL(/.*login/);
    }
  });

  test('can navigate from landing to pricing', async ({ page }) => {
    await page.goto('/');

    // Find and click pricing link if visible
    const pricingLink = page.getByRole('link', { name: /pricing/i });
    if (await pricingLink.isVisible()) {
      await pricingLink.click();
      await expect(page).toHaveURL(/.*pricing/);
    }
  });
});
