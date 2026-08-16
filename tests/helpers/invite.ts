import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { eq, inArray } from 'drizzle-orm';
import { getAdminDb } from '@/db/admin';
import { signupInvitations, users } from '@/db/schema';
import { mintInvitationToken } from '@/lib/auth/invitations';

/**
 * Plants an invitation directly, so the browser suite can exercise activation
 * without a mail server in the loop.
 *
 * The token only ever exists inside an email, which is exactly the property
 * being relied on everywhere else, and it means a test cannot read one back
 * out of the database: the stored value is a hash. So the test supplies the
 * token instead of discovering it, writing the row the signup endpoint would
 * have written. Everything downstream of that (the activation page, the
 * activate endpoint, single use, expiry, sign-in) runs for real over HTTP.
 *
 * What this does NOT cover is the step it replaces, namely that signup writes
 * the right row and mails the right message. That is asserted directly in
 * tests/isolation/invitations.test.ts.
 */

// Playwright does not load .env, and this needs the admin connection string.
for (const file of ['.env.test', '.env']) {
  const path = resolve(process.cwd(), file);
  if (existsSync(path)) loadEnv({ path, override: false });
}

/** Prefix on every address this suite creates, so a stray row is recognisable. */
export const TEST_EMAIL_PREFIX = 'e2e-';

/**
 * Addresses this worker created.
 *
 * Cleanup deletes these and nothing else. Deleting by prefix instead cost an
 * afternoon: Playwright runs afterAll once per worker, not once per run, so
 * the first worker to finish was wiping identities that other workers were
 * still signing in with, and the failure surfaced as an unrelated test
 * getting a 400 from activation.
 */
const created = new Set<string>();

export function testEmail(label: string): string {
  const email = `${TEST_EMAIL_PREFIX}${label}.${Date.now()}.${Math.floor(
    Math.random() * 1e6,
  )}@example.test`;
  created.add(email.toLowerCase());
  return email;
}

export async function plantInvitation(params: {
  tenantId: string;
  email: string;
  firstName?: string;
  lastName?: string;
  role?: 'student' | 'admin';
}): Promise<string> {
  const minted = mintInvitationToken();

  await getAdminDb()
    .insert(signupInvitations)
    .values({
      tenantId: params.tenantId,
      email: params.email.toLowerCase(),
      firstName: params.firstName ?? 'Test',
      lastName: params.lastName ?? 'Person',
      role: params.role ?? 'student',
      tokenHash: minted.tokenHash,
      expiresAt: minted.expiresAt,
    });

  return minted.token;
}

/** Removes what this worker created. Safe to call more than once. */
export async function cleanupTestIdentities(): Promise<void> {
  const mine = [...created];
  if (mine.length === 0) return;

  const db = getAdminDb();
  await db
    .delete(signupInvitations)
    .where(inArray(signupInvitations.email, mine));
  await db.delete(users).where(inArray(users.email, mine));
  created.clear();
}

/** Reads whether an address ended up with a proven mailbox. */
export async function isEmailVerified(email: string): Promise<boolean> {
  const rows = await getAdminDb()
    .select({ emailVerified: users.emailVerified })
    .from(users)
    .where(eq(users.email, email.toLowerCase()));
  return rows[0]?.emailVerified === true;
}
