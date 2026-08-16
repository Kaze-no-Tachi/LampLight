import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PORT ?? 3000);

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Pinned Playwright expects a browser build this image does not ship.
        // Point at the preinstalled Chromium rather than downloading one.
        ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
          ? {
              launchOptions: {
                executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH,
              },
            }
          : {}),
      },
    },
  ],
  webServer: {
    command: 'pnpm build && pnpm start',
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    env: {
      // The suite drives real sign-in, so the server under test needs a
      // signing secret. A fixed development value keeps runs reproducible and
      // never reaches an environment that matters.
      BETTER_AUTH_SECRET:
        process.env.BETTER_AUTH_SECRET ??
        'playwright_development_secret_at_least_32_chars',
      // `next start` runs in production, and platform mode refuses to serve in
      // production without Cloudflare credentials. That guard is working as
      // intended, so the test server is configured like production rather than
      // having the guard relaxed for it. Nothing here calls Cloudflare in this
      // phase, so placeholders are enough.
      CLOUDFLARE_API_TOKEN: 'playwright-placeholder',
      CLOUDFLARE_ZONE_ID: 'playwright-placeholder',
      CLOUDFLARE_SAAS_FALLBACK_ORIGIN: 'origin.lamplight.school',
      // Signup ships disabled, because a signup that works is a signup that
      // leaks until mail verification exists. The suite turns it on anyway:
      // disabled is trivially non-leaking and proves nothing, so the enabled
      // path is the one worth asserting uniform responses against. The default
      // itself is covered in tests/unit/signup-gate.test.ts.
      SELF_SERVE_SIGNUP: 'true',
    },
  },
});
