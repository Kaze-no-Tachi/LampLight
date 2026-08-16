import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeAdminDb, getAdminDb } from '@/db/admin';
import { closeDb, getTenantDb } from '@/db/client';
import { memberships, signupInvitations, users } from '@/db/schema';
import { CORNERSTONE, GRACE } from '@/db/seed-data';
import {
  completeActivation,
  findPendingInvitation,
  hashToken,
  issueInvitation,
  mintInvitationToken,
  sweepInvitations,
} from '@/lib/auth/invitations';

/**
 * Invitations are the only thing standing between a submitted address and an
 * account, so the properties asserted here are the ones the signup design
 * rests on: they do not cross institutes, they cannot be replayed, and they
 * cannot quietly take away access somebody already has.
 */

const HOST = 'grace.lamplight.school';

async function freshEmail(): Promise<string> {
  return `invite-${randomUUID()}@example.test`;
}

/** A throwaway account, since activation writes to the global users row. */
async function createAccount(email: string): Promise<string> {
  const id = randomUUID();
  await getAdminDb()
    .insert(users)
    .values({ id, email, name: 'Test Person', emailVerified: false });
  return id;
}

async function clearInvitations(): Promise<void> {
  await getAdminDb().delete(signupInvitations);
}

beforeEach(async () => {
  await clearInvitations();
});

afterAll(async () => {
  await clearInvitations();
  await getAdminDb()
    .delete(users)
    .where(sql`${users.email} like 'invite-%'`);
  await Promise.all([closeDb(), closeAdminDb()]);
});

describe('invitations do not cross institutes', () => {
  it('is invisible from another tenant, token and all', async () => {
    const email = await freshEmail();
    const issued = await issueInvitation({
      tenantId: GRACE.id,
      host: HOST,
      email,
      firstName: 'Ada',
      lastName: 'Lovelace',
    });
    expect(issued).not.toBeNull();

    const token = new URL(issued?.url ?? '').searchParams.get('token') ?? '';
    expect(token).not.toBe('');

    // The same token, offered to the institute it was not issued for.
    await expect(
      findPendingInvitation(CORNERSTONE.id, token),
    ).resolves.toBeNull();

    // And it still works where it belongs, so the null above is isolation
    // rather than the token simply being wrong.
    await expect(
      findPendingInvitation(GRACE.id, token),
    ).resolves.not.toBeNull();
  });

  it('cannot be activated into the wrong institute', async () => {
    const email = await freshEmail();
    const issued = await issueInvitation({
      tenantId: GRACE.id,
      host: HOST,
      email,
      firstName: 'Ada',
      lastName: 'Lovelace',
    });
    const token = new URL(issued?.url ?? '').searchParams.get('token') ?? '';
    const invitation = await findPendingInvitation(GRACE.id, token);
    expect(invitation).not.toBeNull();
    if (!invitation) return;

    const userId = await createAccount(email);

    // Naming Grace's invitation id while scoped to Cornerstone. The UPDATE
    // matches nothing, because RLS and the explicit tenant filter both exclude
    // the row, so no membership can be conjured at the wrong institute.
    await expect(
      completeActivation({
        tenantId: CORNERSTONE.id,
        invitationId: invitation.id,
        userId,
      }),
    ).resolves.toBe(false);

    const atCornerstone = await getTenantDb(CORNERSTONE.id).run((scope) =>
      scope.tx
        .select({ id: memberships.id })
        .from(memberships)
        .where(
          and(
            eq(memberships.tenantId, scope.tenantId),
            eq(memberships.userId, userId),
          ),
        ),
    );
    expect(atCornerstone).toHaveLength(0);
  });
});

describe('an invitation is spent exactly once', () => {
  it('refuses the second activation', async () => {
    const email = await freshEmail();
    const issued = await issueInvitation({
      tenantId: GRACE.id,
      host: HOST,
      email,
      firstName: 'Ada',
      lastName: 'Lovelace',
    });
    const token = new URL(issued?.url ?? '').searchParams.get('token') ?? '';
    const invitation = await findPendingInvitation(GRACE.id, token);
    if (!invitation) throw new Error('expected an invitation');

    const userId = await createAccount(email);

    await expect(
      completeActivation({
        tenantId: GRACE.id,
        invitationId: invitation.id,
        userId,
      }),
    ).resolves.toBe(true);

    await expect(
      completeActivation({
        tenantId: GRACE.id,
        invitationId: invitation.id,
        userId,
      }),
    ).resolves.toBe(false);

    // And the consumed token no longer resolves, so the link is dead too.
    await expect(findPendingInvitation(GRACE.id, token)).resolves.toBeNull();
  });

  it('marks the address proven and records the name', async () => {
    const email = await freshEmail();
    const issued = await issueInvitation({
      tenantId: GRACE.id,
      host: HOST,
      email,
      firstName: 'Ada',
      lastName: 'Lovelace',
    });
    const token = new URL(issued?.url ?? '').searchParams.get('token') ?? '';
    const invitation = await findPendingInvitation(GRACE.id, token);
    if (!invitation) throw new Error('expected an invitation');

    const userId = await createAccount(email);
    await completeActivation({
      tenantId: GRACE.id,
      invitationId: invitation.id,
      userId,
    });

    const row = await getAdminDb()
      .select({
        emailVerified: users.emailVerified,
        firstName: users.firstName,
        lastName: users.lastName,
      })
      .from(users)
      .where(eq(users.id, userId));

    // Following a link that was only ever sent to that address is precisely
    // the claim email verification makes, so this is the conclusion and not a
    // shortcut. Sign-in requires it.
    expect(row[0]?.emailVerified).toBe(true);
    expect(row[0]?.firstName).toBe('Ada');
    expect(row[0]?.lastName).toBe('Lovelace');
  });

  it('ignores an expired invitation', async () => {
    const email = await freshEmail();
    const minted = mintInvitationToken();

    await getAdminDb()
      .insert(signupInvitations)
      .values({
        tenantId: GRACE.id,
        email,
        tokenHash: minted.tokenHash,
        expiresAt: new Date(Date.now() - 1000),
      });

    await expect(
      findPendingInvitation(GRACE.id, minted.token),
    ).resolves.toBeNull();
  });

  it('matches on the hash, so the stored value is not the credential', async () => {
    const email = await freshEmail();
    const issued = await issueInvitation({
      tenantId: GRACE.id,
      host: HOST,
      email,
      firstName: 'Ada',
      lastName: 'Lovelace',
    });
    const token = new URL(issued?.url ?? '').searchParams.get('token') ?? '';

    const stored = await getAdminDb()
      .select({ tokenHash: signupInvitations.tokenHash })
      .from(signupInvitations)
      .where(eq(signupInvitations.email, email));

    expect(stored[0]?.tokenHash).toBe(hashToken(token));
    expect(stored[0]?.tokenHash).not.toBe(token);

    // Offering the stored value instead of the token gets nowhere, which is
    // what makes a leaked row something other than a working credential.
    await expect(
      findPendingInvitation(GRACE.id, stored[0]?.tokenHash ?? ''),
    ).resolves.toBeNull();
  });
});

describe('issuing', () => {
  it('suppresses a second invitation inside the cooldown', async () => {
    const email = await freshEmail();

    await expect(
      issueInvitation({
        tenantId: GRACE.id,
        host: HOST,
        email,
        firstName: 'Ada',
        lastName: 'Lovelace',
      }),
    ).resolves.not.toBeNull();

    // Otherwise the signup form is a way to mail somebody repeatedly by
    // submitting an address you do not own.
    await expect(
      issueInvitation({
        tenantId: GRACE.id,
        host: HOST,
        email,
        firstName: 'Ada',
        lastName: 'Lovelace',
      }),
    ).resolves.toBeNull();
  });

  it('lets the same address be invited by two institutes independently', async () => {
    const email = await freshEmail();

    const atGrace = await issueInvitation({
      tenantId: GRACE.id,
      host: HOST,
      email,
      firstName: 'Ada',
      lastName: 'Lovelace',
    });
    const atCornerstone = await issueInvitation({
      tenantId: CORNERSTONE.id,
      host: 'cornerstone.lamplight.school',
      email,
      firstName: 'Ada',
      lastName: 'Lovelace',
    });

    // The cooldown is per institute, because a platform-wide one would let one
    // institute's signup form silently block another's.
    expect(atGrace).not.toBeNull();
    expect(atCornerstone).not.toBeNull();
  });

  it('never demotes an existing admin', async () => {
    const email = await freshEmail();
    const userId = await createAccount(email);

    await getTenantDb(GRACE.id).run((scope) =>
      scope.tx.insert(memberships).values({
        tenantId: scope.tenantId,
        userId,
        role: 'admin',
      }),
    );

    const issued = await issueInvitation({
      tenantId: GRACE.id,
      host: HOST,
      email,
      firstName: 'Ada',
      lastName: 'Lovelace',
      role: 'student',
    });
    const token = new URL(issued?.url ?? '').searchParams.get('token') ?? '';
    const invitation = await findPendingInvitation(GRACE.id, token);
    if (!invitation) throw new Error('expected an invitation');

    await completeActivation({
      tenantId: GRACE.id,
      invitationId: invitation.id,
      userId,
    });

    const after = await getTenantDb(GRACE.id).run((scope) =>
      scope.tx
        .select({ role: memberships.role })
        .from(memberships)
        .where(
          and(
            eq(memberships.tenantId, scope.tenantId),
            eq(memberships.userId, userId),
          ),
        ),
    );

    // Inviting an institute's own administrator to a class must not strip
    // their administration of it.
    expect(after[0]?.role).toBe('admin');
  });
});

describe('the retention sweep', () => {
  it('deletes an expired invitation nobody ever used', async () => {
    const email = await freshEmail();
    const minted = mintInvitationToken();

    await getAdminDb()
      .insert(signupInvitations)
      .values({
        tenantId: GRACE.id,
        email,
        tokenHash: minted.tokenHash,
        expiresAt: new Date(Date.now() - 1000),
      });

    const result = await sweepInvitations(GRACE.id);

    // Not about access: it stopped working at expiry. It is about what the row
    // holds, which is an address and a name belonging to somebody who never
    // became a user and now never will.
    expect(result.expired).toBe(1);
    await expect(
      findPendingInvitation(GRACE.id, minted.token),
    ).resolves.toBeNull();
  });

  it('leaves a live invitation alone', async () => {
    const email = await freshEmail();
    await issueInvitation({
      tenantId: GRACE.id,
      host: HOST,
      email,
      firstName: 'Ada',
      lastName: 'Lovelace',
    });

    const result = await sweepInvitations(GRACE.id);
    expect(result.expired).toBe(0);
  });

  it('keeps a recently consumed one, and drops an old one', async () => {
    const recent = await freshEmail();
    const ancient = await freshEmail();

    await getAdminDb()
      .insert(signupInvitations)
      .values([
        {
          tenantId: GRACE.id,
          email: recent,
          tokenHash: mintInvitationToken().tokenHash,
          expiresAt: new Date(Date.now() - 1000),
          consumedAt: new Date(),
        },
        {
          tenantId: GRACE.id,
          email: ancient,
          tokenHash: mintInvitationToken().tokenHash,
          expiresAt: new Date(Date.now() - 1000),
          // Older than the ninety day retention window.
          consumedAt: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000),
        },
      ]);

    const result = await sweepInvitations(GRACE.id);

    // A consumed row is how an institute can see that somebody was invited and
    // what they were asked. After the window the membership is that record.
    expect(result.spent).toBe(1);

    const left = await getAdminDb()
      .select({ email: signupInvitations.email })
      .from(signupInvitations)
      .where(eq(signupInvitations.tenantId, GRACE.id));
    const addresses = left.map((row) => row.email);
    expect(addresses).toContain(recent);
    expect(addresses).not.toContain(ancient);
  });

  it('never reaches another institute rows', async () => {
    const email = await freshEmail();
    await getAdminDb()
      .insert(signupInvitations)
      .values({
        tenantId: CORNERSTONE.id,
        email,
        tokenHash: mintInvitationToken().tokenHash,
        expiresAt: new Date(Date.now() - 1000),
      });

    // Sweeping Grace must not touch Cornerstone, however expired the row is.
    const result = await sweepInvitations(GRACE.id);
    expect(result.expired).toBe(0);

    const survived = await getAdminDb()
      .select({ id: signupInvitations.id })
      .from(signupInvitations)
      .where(eq(signupInvitations.tenantId, CORNERSTONE.id));
    expect(survived).toHaveLength(1);
  });
});

describe('institute-specific answers', () => {
  it('land on the membership, not on the global user', async () => {
    const email = await freshEmail();

    const issued = await issueInvitation({
      tenantId: GRACE.id,
      host: HOST,
      email,
      firstName: 'Ada',
      lastName: 'Lovelace',
      answers: { congregation: 'Grace Chapel', track: 'Pastoral' },
    });
    const token = new URL(issued?.url ?? '').searchParams.get('token') ?? '';
    const invitation = await findPendingInvitation(GRACE.id, token);
    if (!invitation) throw new Error('expected an invitation');

    const userId = await createAccount(email);
    await completeActivation({
      tenantId: GRACE.id,
      invitationId: invitation.id,
      userId,
    });

    const membership = await getTenantDb(GRACE.id).run((scope) =>
      scope.tx
        .select({ profile: memberships.profileJson })
        .from(memberships)
        .where(
          and(
            eq(memberships.tenantId, scope.tenantId),
            eq(memberships.userId, userId),
          ),
        ),
    );

    expect(membership[0]?.profile).toEqual({
      congregation: 'Grace Chapel',
      track: 'Pastoral',
    });

    // The whole reason for the column being here. Storing this globally would
    // carry Grace's intake answers to Cornerstone the moment the same person
    // enrolled there, and the isolation suite would never see it, because the
    // users row is legitimately global.
    const globalUser = await getAdminDb()
      .select()
      .from(users)
      .where(eq(users.id, userId));
    expect(JSON.stringify(globalUser[0])).not.toContain('Grace Chapel');
  });

  it('do not follow the person to another institute', async () => {
    const email = await freshEmail();
    const userId = await createAccount(email);

    // Joined at Grace with answers.
    const atGrace = await issueInvitation({
      tenantId: GRACE.id,
      host: HOST,
      email,
      firstName: 'Ada',
      lastName: 'Lovelace',
      answers: { congregation: 'Grace Chapel' },
    });
    const graceToken =
      new URL(atGrace?.url ?? '').searchParams.get('token') ?? '';
    const graceInvitation = await findPendingInvitation(GRACE.id, graceToken);
    if (!graceInvitation) throw new Error('expected an invitation');
    await completeActivation({
      tenantId: GRACE.id,
      invitationId: graceInvitation.id,
      userId,
    });

    // Then joined at Cornerstone, which asks nothing.
    const atCornerstone = await issueInvitation({
      tenantId: CORNERSTONE.id,
      host: 'cornerstone.lamplight.school',
      email,
      firstName: 'Ada',
      lastName: 'Lovelace',
    });
    const cornerstoneToken =
      new URL(atCornerstone?.url ?? '').searchParams.get('token') ?? '';
    const cornerstoneInvitation = await findPendingInvitation(
      CORNERSTONE.id,
      cornerstoneToken,
    );
    if (!cornerstoneInvitation) throw new Error('expected an invitation');
    await completeActivation({
      tenantId: CORNERSTONE.id,
      invitationId: cornerstoneInvitation.id,
      userId,
    });

    const atOther = await getTenantDb(CORNERSTONE.id).run((scope) =>
      scope.tx
        .select({ profile: memberships.profileJson })
        .from(memberships)
        .where(
          and(
            eq(memberships.tenantId, scope.tenantId),
            eq(memberships.userId, userId),
          ),
        ),
    );

    expect(atOther[0]?.profile).toEqual({});
  });
});
