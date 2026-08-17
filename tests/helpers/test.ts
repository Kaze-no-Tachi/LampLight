import { test as base, expect } from '@playwright/test';

/**
 * The browser suite's `test`, which differs from Playwright's in one way: each
 * test presents itself as a distinct client address.
 *
 * WHY THIS IS NEEDED, AND WHY IT IS NOT A RELAXATION. Sign-in is rate limited
 * per client address, and the address comes from the header the proxy in front
 * of the application sets (see the note on `ipAddress` in src/lib/auth). The
 * test server has no proxy, so without this every test in the suite shares one
 * bucket: three sign-ins succeed and the rest get 429. That is not a flaky
 * test, it is fifty tests behaving like one very determined attacker, and the
 * fix is to stop lying about how many clients there are rather than to turn
 * the limit off.
 *
 * The limit therefore stays fully armed, and this exercises the same header
 * path production uses. A test that wants to assert the limit itself can still
 * do so by reusing one address.
 *
 * The retry number is part of the address, so a retry is a fresh client rather
 * than one continuing to hammer the bucket its previous attempt filled.
 */

/** A stable private address per string, so a test always gets the same one. */
export function clientAddress(seed: string): string {
  // FNV-1a, which is plenty for spreading a few dozen names across a /8 and
  // needs no dependency.
  let hash = 2_166_136_261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }

  const octet = (shift: number) => (hash >>> shift) & 0xff || 1;
  return `10.${octet(16)}.${octet(8)}.${octet(0)}`;
}

/** The headers that make a request look like it came from `address`. */
export function clientHeaders(address: string): Record<string, string> {
  // Both, because which one is read depends on TENANCY_MODE and a test helper
  // should not have to know which mode the server under test is in.
  return { 'cf-connecting-ip': address, 'x-forwarded-for': address };
}

export const test = base.extend({
  // The second argument is Playwright's `use`, taken positionally and named
  // `provide` here because the React hooks lint rule reads any call to a
  // function called `use` as a hook and refuses it outside a component.
  contextOptions: async ({ contextOptions }, provide, testInfo) => {
    const address = clientAddress(
      `${testInfo.titlePath.join(' > ')}#${testInfo.retry}`,
    );

    await provide({
      ...contextOptions,
      extraHTTPHeaders: {
        ...contextOptions.extraHTTPHeaders,
        ...clientHeaders(address),
      },
    });
  },
});

export { expect };
