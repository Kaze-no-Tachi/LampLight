import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { getTenantDb } from '@/db/client';
import { memberships, signupInvitations, users } from '@/db/schema';
import type { TenantScope } from '@/db/scope';
import type { MembershipRole } from './guards';
import { absoluteUrl } from '@/lib/tenancy/host';

/**
 * Invitations: the mechanism that makes account creation deferred.
 *
 * Signing up creates one of these and sends a link. Nothing else happens. No
 * user row, no credential, no membership, and therefore nothing an attacker
 * who submitted somebody else's address can test. That is what closes the
 * account-existence oracle described in the addendum to ADR 0003, and it is
 * the reason this module exists rather than the signup route simply calling
 * Better Auth.
 *
 * Provisioning an institute uses the same path with role 'admin', so there is
 * exactly one way an account comes into being and exactly one place to audit.
 */

/** 32 bytes of randomness, base64url. Long enough that guessing is not a threat. */
const TOKEN_BYTES = 32;

/**
 * Three days.
 *
 * Long enough to survive a weekend and a spam folder, short enough that an
 * invitation forwarded or left in an archived inbox stops being a way in. The
 * cost of expiry is asking for another link, which is cheap.
 */
const TTL_MS = 72 * 60 * 60 * 1000;

/**
 * How long a pending invitation suppresses issuing another for the same
 * address at the same institute.
 *
 * Without this, the signup form is a way to send somebody a message every time
 * it is submitted, so anyone can point it at an address they do not own and
 * make the institute's own mail be the nuisance. Suppression is silent: the
 * caller gets the same answer either way, because telling them a request was
 * suppressed would reveal that an invitation is already outstanding.
 */
const RESEND_COOLDOWN_MS = 15 * 60 * 1000;

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export type MintedToken = {
  /** Only ever leaves the process inside an email. */
  readonly token: string;
  readonly tokenHash: string;
  readonly expiresAt: Date;
};

/**
 * Mints a token and its expiry.
 *
 * Exported because provisioning writes its invitation inside the same
 * transaction that creates the institute, using the cross-tenant client, since
 * there is no tenant to scope to until that transaction commits. It uses this
 * rather than its own generator so that both paths agree on token length and
 * lifetime, and so changing either changes both.
 */
export function mintInvitationToken(): MintedToken {
  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  return {
    token,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + TTL_MS),
  };
}

/** The path an invitation link points at, given its token. */
export function activationPath(token: string): string {
  return `/activate?token=${encodeURIComponent(token)}`;
}

export type InvitationRole = Extract<MembershipRole, 'student' | 'admin'>;

export type IssuedInvitation = {
  readonly url: string;
  readonly expiresAt: Date;
};

export type InvitationRequest = {
  readonly tenantId: string;
  /** The host the link should point at, which is this institute's own. */
  readonly host: string;
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly role?: InvitationRole;
  /** Answers to this institute's own signup questions. */
  readonly answers?: Record<string, unknown>;
};

/**
 * Issues an invitation, or returns null when one was issued recently.
 *
 * Callers must treat null as an ordinary outcome and answer exactly as they do
 * on success. It means "no mail to send", never "this failed".
 */
export async function issueInvitation(
  request: InvitationRequest,
): Promise<IssuedInvitation | null> {
  const email = request.email.trim().toLowerCase();
  const { token, tokenHash, expiresAt } = mintInvitationToken();

  const issued = await getTenantDb(request.tenantId).run(async (scope) => {
    const recent = await scope.tx
      .select({ id: signupInvitations.id })
      .from(signupInvitations)
      .where(
        and(
          eq(signupInvitations.tenantId, scope.tenantId),
          eq(signupInvitations.email, email),
          isNull(signupInvitations.consumedAt),
          gt(
            signupInvitations.createdAt,
            new Date(Date.now() - RESEND_COOLDOWN_MS),
          ),
        ),
      )
      .limit(1);

    if (recent.length > 0) return false;

    // Any older pending invitation for this address is superseded. Leaving it
    // alive would mean several working links for one account, each of which is
    // a credential sitting in an inbox.
    await scope.tx
      .delete(signupInvitations)
      .where(
        and(
          eq(signupInvitations.tenantId, scope.tenantId),
          eq(signupInvitations.email, email),
          isNull(signupInvitations.consumedAt),
        ),
      );

    await scope.tx.insert(signupInvitations).values({
      tenantId: scope.tenantId,
      email,
      firstName: request.firstName,
      lastName: request.lastName,
      answersJson: request.answers ?? {},
      role: request.role ?? 'student',
      tokenHash,
      expiresAt,
    });

    return true;
  });

  if (!issued) return null;

  return { url: absoluteUrl(request.host, activationPath(token)), expiresAt };
}

export type PendingInvitation = {
  readonly id: string;
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly role: InvitationRole;
  readonly answers: Record<string, unknown>;
};

/**
 * Finds an invitation by its token, within this institute only.
 *
 * The lookup is by hash, so a token that is not the one that was mailed
 * matches nothing. Expired and already-consumed rows are excluded here rather
 * than checked by the caller, so there is no path that forgets.
 */
export async function findPendingInvitation(
  tenantId: string,
  token: string,
): Promise<PendingInvitation | null> {
  if (!token) return null;

  return getTenantDb(tenantId).run(async (scope) => {
    const rows = await scope.tx
      .select({
        id: signupInvitations.id,
        email: signupInvitations.email,
        firstName: signupInvitations.firstName,
        lastName: signupInvitations.lastName,
        role: signupInvitations.role,
        answers: signupInvitations.answersJson,
        tokenHash: signupInvitations.tokenHash,
      })
      .from(signupInvitations)
      .where(
        and(
          eq(signupInvitations.tenantId, scope.tenantId),
          eq(signupInvitations.tokenHash, hashToken(token)),
          isNull(signupInvitations.consumedAt),
          gt(signupInvitations.expiresAt, new Date()),
        ),
      )
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    // The WHERE already matched on the hash, so this compares two values that
    // are equal whenever the row exists. It is here so that the comparison
    // deciding whether a token is accepted is constant time even if this
    // function is later changed to fetch by something cheaper than the hash.
    if (!constantTimeEquals(row.tokenHash, hashToken(token))) return null;

    return {
      id: row.id,
      email: row.email,
      firstName: row.firstName,
      lastName: row.lastName,
      // The column is the membership_role enum, which is wider than what an
      // invitation may carry. Anything unexpected degrades to the least
      // privileged role rather than being trusted.
      role: row.role === 'admin' ? 'admin' : 'student',
      answers: (row.answers ?? {}) as Record<string, unknown>,
    };
  });
}

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Completes an activation: the invitation is spent, the person becomes a
 * member of this institute, and their address counts as proven.
 *
 * All of it in one transaction, so there is no state where the invitation has
 * been consumed but the membership was never written, which would leave
 * somebody holding an account with no way into the institute that invited
 * them and no link left to try.
 *
 * The single-use guarantee is the `consumed_at IS NULL` predicate on the
 * UPDATE rather than a read followed by a write. Two clicks racing each other
 * both find the row pending; only one gets a row back, and the other is told
 * the link is spent, which is true.
 */
export async function completeActivation(params: {
  tenantId: string;
  invitationId: string;
  userId: string;
}): Promise<boolean> {
  return getTenantDb(params.tenantId).run(async (scope) => {
    const claimed = await scope.tx
      .update(signupInvitations)
      .set({ consumedAt: new Date() })
      .where(
        and(
          eq(signupInvitations.tenantId, scope.tenantId),
          eq(signupInvitations.id, params.invitationId),
          isNull(signupInvitations.consumedAt),
        ),
      )
      .returning({
        email: signupInvitations.email,
        firstName: signupInvitations.firstName,
        lastName: signupInvitations.lastName,
        role: signupInvitations.role,
        answers: signupInvitations.answersJson,
      });

    const invitation = claimed[0];
    if (!invitation) return false;

    await attachMembership(scope, params.userId, invitation);
    await markAddressProven(scope, params.userId, invitation);

    return true;
  });
}

type ClaimedInvitation = {
  firstName: string;
  lastName: string;
  role: 'student' | 'instructor' | 'admin';
  answers: unknown;
};

/**
 * Writes the membership, or upgrades the existing one if the person is already
 * a member.
 *
 * The upgrade is deliberately one-directional: an invitation can raise
 * somebody to admin, but a student invitation must never demote an existing
 * admin, or inviting an institute's own administrator to a class would strip
 * their access.
 */
async function attachMembership(
  scope: TenantScope,
  userId: string,
  invitation: ClaimedInvitation,
): Promise<void> {
  const answers = (invitation.answers ?? {}) as Record<string, unknown>;

  await scope.tx
    .insert(memberships)
    .values({
      tenantId: scope.tenantId,
      userId,
      role: invitation.role,
      profileJson: answers,
    })
    .onConflictDoUpdate({
      target: [memberships.tenantId, memberships.userId],
      set: {
        role: sql`case when ${memberships.role} = 'admin' then ${memberships.role} else excluded.role end`,
        profileJson: answers,
      },
    });
}

/**
 * Records the name they gave and marks the address verified.
 *
 * Verified is the right conclusion and not a shortcut: they followed a link
 * that was only ever sent to that address, which is precisely the claim email
 * verification makes. Doing it here is also what lets sign-in require a
 * verified address without locking out everyone who arrived by invitation.
 *
 * `users` is global and carries no RLS policy, so this write is not protected
 * by the database layer. It is scoped by the user id the caller established,
 * and it runs inside the tenant transaction so that a failure here rolls back
 * the consumed invitation along with it.
 */
async function markAddressProven(
  scope: TenantScope,
  userId: string,
  invitation: ClaimedInvitation,
): Promise<void> {
  const display = [invitation.firstName, invitation.lastName]
    .filter(Boolean)
    .join(' ')
    .trim();

  await scope.tx
    .update(users)
    .set({
      emailVerified: true,
      firstName: invitation.firstName,
      lastName: invitation.lastName,
      // Better Auth owns `name`, and an account created moments ago has
      // whatever placeholder the signup call passed. Only overwrite it when
      // the invitation actually carries something better.
      ...(display ? { name: display } : {}),
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));
}
