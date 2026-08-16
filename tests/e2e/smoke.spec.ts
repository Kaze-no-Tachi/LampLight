import { expect, test } from '@playwright/test';

/**
 * Boot check.
 *
 * Note what "/" does on an unrecognised host now: it 404s. This test used to
 * expect 200, from the phase where "/" was a placeholder page with no tenancy.
 * Since host resolution landed, localhost belongs to no institute, and a
 * generic 404 is the correct and required answer. Keeping the old expectation
 * would have meant loosening tenant resolution to make a test pass.
 */
test('serves the health endpoint', async ({ request }) => {
  const response = await request.get('/api/health');
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({ status: 'ok' });
});

test('refuses a host that belongs to no institute', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.status()).toBe(404);
});
