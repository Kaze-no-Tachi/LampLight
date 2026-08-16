import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getTenantDb } from '@/db/client';
import { memberships } from '@/db/schema';
import { getAuth } from '@/lib/auth';
import { getTenant } from '@/lib/tenancy/context';
import { getEnv } from '@/env';

/**
 * Signup on an institute's domain.
 *
 * THE OBLIGATION THIS DISCHARGES (ADR 0003)
 *
 * Identity is global and emails are unique platform-wide, so a naive signup
 * leaks: "that email is taken" tells whoever asked that the person holds an
 * account at some other institute. Over a list of addresses that turns into a
 * roster of a competitor's students. So both outcomes answer identically.
 *
 *   new email       -> create the user, attach a student membership
 *   existing email  -> change nothing at all
 *
 * Same status, same body, and no session cookie in either case, so the two are
 * indistinguishable to the caller from the response alone.
 *
 * WHY THIS IS OFF BY DEFAULT
 *
 * Making the response uniform is not sufficient on its own. An attacker can
 * sign up and then try to sign in with the password they just chose: success
 * means the address was new, failure means it already existed. No amount of
 * response-shaping closes that, because the difference is genuinely there.
 *
 * The fix is to activate nothing until a link sent to the address is followed,
 * so both paths end at "check your email" and there is nothing to test. That
 * needs mail delivery, which the PRD schedules as P1, while the property it
 * protects is P0-5. Those two cannot both hold, so signup stays disabled by
 * SELF_SERVE_SIGNUP until mail exists, and P0-5 is true today because the
 * oracle has no endpoint to run against.
 *
 * Disabled does not mean different. The request is accepted and answered
 * exactly as it is when enabled, so the flag's setting is not observable.
 *
 * An existing account is deliberately NOT given a membership here. Doing so
 * would let anyone attach themselves to a stranger's account by guessing their
 * address, which trades an information leak for account takeover.
 */

export const dynamic = 'force-dynamic';

const UNIFORM_RESPONSE = {
  status: 'ok',
  message:
    'If that address can be registered, the account is ready to sign in.',
} as const;

type SignUpBody = { email?: unknown; password?: unknown; name?: unknown };

export async function POST(request: Request): Promise<NextResponse> {
  const tenant = await getTenant();
  // No tenant means this host serves no institute, and signing up is not a
  // thing that can happen here.
  if (!tenant) {
    return NextResponse.json({ status: 'not_found' }, { status: 404 });
  }

  let body: SignUpBody;
  try {
    body = (await request.json()) as SignUpBody;
  } catch {
    return NextResponse.json({ status: 'invalid' }, { status: 400 });
  }

  const email =
    typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const name = typeof body.name === 'string' ? body.name.trim() : '';

  // Shape validation is safe to answer honestly: it says nothing about who
  // holds an account.
  if (!email.includes('@') || password.length < 12) {
    return NextResponse.json({ status: 'invalid' }, { status: 400 });
  }

  // Accepted and answered identically whether or not signup is enabled, so
  // the configuration cannot be probed from outside.
  if (!getEnv().SELF_SERVE_SIGNUP) {
    return NextResponse.json(UNIFORM_RESPONSE, { status: 200 });
  }

  const auth = getAuth();

  try {
    const created = await auth.api.signUpEmail({
      body: { email, password, name: name || email.split('@')[0] || 'Student' },
      asResponse: false,
    });

    if (created?.user?.id) {
      await attachStudentMembership(tenant.id, created.user.id);
    }
  } catch {
    // Swallowed on purpose. The most likely cause is that the address is
    // already registered, and distinguishing that from success is the leak
    // this endpoint exists to prevent. Genuine faults are caught by the
    // account simply not existing when the person tries to sign in.
  }

  return NextResponse.json(UNIFORM_RESPONSE, { status: 200 });
}

/**
 * Attaches the student membership that turns a global identity into a member
 * of this institute.
 *
 * Written through getTenantDb rather than a repository module because it is a
 * write, and the repositories are the tenant-scoped read surface that the
 * isolation harness enumerates. It still takes the tenant scope first, so the
 * row cannot land in the wrong institute: RLS would reject a tenant_id that
 * disagrees with the session setting.
 */
async function attachStudentMembership(
  tenantId: string,
  userId: string,
): Promise<void> {
  await getTenantDb(tenantId).run(async (scope) => {
    const existing = await scope.tx
      .select({ id: memberships.id })
      .from(memberships)
      .where(eq(memberships.userId, userId))
      .limit(1);

    if (existing.length > 0) return;

    await scope.tx.insert(memberships).values({
      tenantId: scope.tenantId,
      userId,
      role: 'student',
    });
  });
}
