import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PORT ?? 3000);

export default defineConfig({
  testDir: './tests/e2e',
  // Runs before the web server starts, so the server comes up against a
  // database this suite established rather than one an earlier command left
  // behind. See the note in the file.
  globalSetup: './tests/e2e-setup.ts',
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
        // EVERY TENANT PAGE IS A FUNCTION OF THE HOST HEADER.
        //
        // A browser cannot be told to send a Host that disagrees with the URL,
        // and it should not be: that is the header the whole isolation model
        // turns on. So the browser resolves the institutes' real hostnames to
        // the local server instead, which means these tests navigate to
        // http://grace.lamplight.school:3000 exactly as a person would, with a
        // real Origin, real cookies, and real canonical redirects.
        //
        // Doing it here rather than in /etc/hosts keeps it working on any
        // machine and in CI without root.
        // Pinned Playwright expects a browser build this image does not ship.
        // Point at the preinstalled Chromium rather than downloading one.
        launchOptions: {
          args: [
            `--host-resolver-rules=MAP *.lamplight.school 127.0.0.1, MAP lamplight.school 127.0.0.1, MAP *.gracebible.test 127.0.0.1`,
            // Playback in a headless browser needs no gesture policy fight.
            '--autoplay-policy=no-user-gesture-required',
          ],
          // Pinned Playwright expects a browser build some images do not ship.
          ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
            ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
            : {}),
        },
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
      // `next start` is a production build, which marks the session cookie
      // Secure, and this suite drives it over plain http. Without this the
      // browser silently discards the cookie: sign-in answers 200 with a real
      // token and every page afterwards renders as an anonymous visitor. That
      // is exactly how nine of these tests failed while appearing to pass
      // locally against a leftover development server.
      INSECURE_HTTP: 'true',
      CLOUDFLARE_API_TOKEN: 'playwright-placeholder',
      CLOUDFLARE_ZONE_ID: 'playwright-placeholder',
      CLOUDFLARE_SAAS_FALLBACK_ORIGIN: 'origin.lamplight.school',
      // Signup ships disabled, because a signup that works is a signup that
      // leaks until mail verification exists. The suite turns it on anyway:
      // disabled is trivially non-leaking and proves nothing, so the enabled
      // path is the one worth asserting uniform responses against. The default
      // itself is covered in tests/unit/signup-gate.test.ts.
      SELF_SERVE_SIGNUP: 'true',
      // `next start` runs in production, which refuses to serve without SMTP
      // configured, because an instance that cannot deliver mail cannot let
      // anybody finish creating an account. That guard is working as intended,
      // so the test server states a choice instead of having the guard
      // relaxed for it: mail goes to the log. Nothing in the suite reads it,
      // since activation tokens are planted directly (tests/helpers/invite.ts).
      MAIL_TRANSPORT: 'console',
      // The media path is part of what the browser suite covers now, so the
      // server under test needs a bucket. These match the development stack
      // and CI's minio service.
      S3_ENDPOINT: process.env.S3_ENDPOINT ?? 'http://localhost:9000',
      S3_REGION: process.env.S3_REGION ?? 'us-east-1',
      S3_BUCKET: process.env.S3_BUCKET ?? 'lamplight-media',
      S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? 'lamplight_minio',
      S3_SECRET_ACCESS_KEY:
        process.env.S3_SECRET_ACCESS_KEY ?? 'lamplight_minio_password',
      S3_FORCE_PATH_STYLE: 'true',
    },
  },
});
