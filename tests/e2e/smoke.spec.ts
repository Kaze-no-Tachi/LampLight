import { expect, test } from '@playwright/test';

// Placeholder so the Playwright wiring is proven before there is any UI to
// drive. Phase 2 replaces this with host-based tenant resolution coverage.
test('the application boots', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});
