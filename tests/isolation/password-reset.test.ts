import { randomUUID } from 'node:crypto';
import { inArray } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeAdminDb, getAdminDb } from '@/db/admin';
import { closeDb } from '@/db/client';
import { users } from '@/db/schema';
import { CORNERSTONE, GRACE } from '@/db/seed-data';
import { getAuth } from '@/lib/auth';
import { withSendingInstitute } from '@/lib/auth/sending-institute';
import { drainOutbox } from '@/lib/mail';

/**
 * The reset link has to arrive on the institute the person asked from.
 *
 * This is the whole reason password reset is not simply Better Auth's endpoint
 * exposed to the browser. The library builds links against one configured base
 * URL, and on a platform of many hostnames one value is wrong for everybody
 * except at most one institute. A link on the wrong institute's domain is not a
 * cosmetic defect: it invites somebody to type their password somewhere they
 * have no relationship with.
 *
 * Under NODE_ENV=test the mail transport captures rather than sends, so these
 * assert against the message that would have gone out.
 */

const created: string[] = [];

async function accountFor(label: string): Promise<string> {
  const email = `reset-${label}-${randomUUID()}@example.test`;
  created.push(email);

  await getAdminDb().insert(users).values({
    id: randomUUID(),
    email,
    name: 'Reset Person',
    emailVerified: true,
  });

  return email;
}

function linkFrom(text: string): URL {
  const match = text.match(/https?:\/\/\S+/);
  if (!match) throw new Error(`no link in message:\n${text}`);
  return new URL(match[0]);
}

beforeEach(() => {
  drainOutbox();
});

afterAll(async () => {
  if (created.length > 0) {
    await getAdminDb().delete(users).where(inArray(users.email, created));
  }
  // The verification rows these leave behind carry no foreign key and expire
  // on their own within the hour. `pnpm db:reset` clears them along with
  // everything else, so they are not worth a targeted delete that could match
  // a real token in a development database.
  await Promise.all([closeDb(), closeAdminDb()]);
});

describe('a reset link is built on the institute that was asked', () => {
  it('points at the requesting host, not the configured base URL', async () => {
    const email = await accountFor('host');

    await withSendingInstitute(
      { host: 'learn.gracebible.test', name: GRACE.name },
      () => getAuth().api.requestPasswordReset({ body: { email } }),
    );

    const sent = drainOutbox();
    expect(sent).toHaveLength(1);

    const link = linkFrom(sent[0]?.text ?? '');
    // BETTER_AUTH_URL is localhost in development, so a link built by the
    // library rather than by us would say so.
    expect(link.host).toBe('learn.gracebible.test');
    expect(link.pathname).toBe('/reset-password');
    expect(link.searchParams.get('token')).toBeTruthy();
    expect(sent[0]?.subject).toContain(GRACE.name);
  });

  it('keeps two institutes apart when they ask at the same time', async () => {
    // The context is per async call rather than a module variable precisely so
    // this cannot interleave. A shared variable would send one institute's
    // user a link on the other's domain, which is the failure mode this whole
    // mechanism exists to prevent.
    const [graceEmail, cornerstoneEmail] = await Promise.all([
      accountFor('grace'),
      accountFor('cornerstone'),
    ]);

    await Promise.all([
      withSendingInstitute(
        { host: 'grace.lamplight.school', name: GRACE.name },
        () =>
          getAuth().api.requestPasswordReset({ body: { email: graceEmail } }),
      ),
      withSendingInstitute(
        { host: 'cornerstone.lamplight.school', name: CORNERSTONE.name },
        () =>
          getAuth().api.requestPasswordReset({
            body: { email: cornerstoneEmail },
          }),
      ),
    ]);

    const byRecipient = new Map(
      drainOutbox().map((message) => [message.to, message]),
    );
    expect(byRecipient.size).toBe(2);

    expect(linkFrom(byRecipient.get(graceEmail)?.text ?? '').host).toBe(
      'grace.lamplight.school',
    );
    expect(linkFrom(byRecipient.get(cornerstoneEmail)?.text ?? '').host).toBe(
      'cornerstone.lamplight.school',
    );
  });

  it('sends nothing at all for an address with no account', async () => {
    await withSendingInstitute(
      { host: 'grace.lamplight.school', name: GRACE.name },
      () =>
        getAuth().api.requestPasswordReset({
          body: { email: `absent-${randomUUID()}@example.test` },
        }),
    );

    // The endpoint answers the same either way, so silence here is the only
    // difference between the two cases, and it reaches nobody.
    expect(drainOutbox()).toHaveLength(0);
  });

  it('sends nothing when there is no institute in scope', async () => {
    const email = await accountFor('nocontext');

    // Outside a request there is no host, and guessing one is exactly the bug
    // being avoided. Sending nothing is the correct failure.
    await getAuth().api.requestPasswordReset({ body: { email } });

    expect(drainOutbox()).toHaveLength(0);
  });
});
