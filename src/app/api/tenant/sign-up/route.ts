import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { findAccountByEmail, getTenantDb } from '@/db/client';
import { tenantSettings } from '@/db/schema';
import { issueInvitation } from '@/lib/auth/invitations';
import { sendMail } from '@/lib/mail';
import { activationEmail, existingAccountEmail } from '@/lib/mail/messages';
import { getTenant } from '@/lib/tenancy/context';
import type { TenantContext } from '@/lib/tenancy/resolve';
import { getEnv } from '@/env';

/**
 * Signup on an institute's domain. It creates no account.
 *
 * WHAT IT ACTUALLY DOES
 *
 * It records an invitation and sends a link to the address. That is all. There
 * is no user row, no credential, and no membership until somebody opens their
 * mail and follows the link, which is handled by /activate.
 *
 * THE OBLIGATION THIS DISCHARGES (ADR 0003 and its addendum)
 *
 * Identity is global and addresses are unique platform-wide, so a signup that
 * creates accounts leaks: "that email is taken" tells whoever asked that the
 * person studies somewhere on this platform, and over a list of addresses that
 * is a roster of a competitor's students.
 *
 * Making the response uniform is necessary and was never sufficient. While
 * signup created an account, an attacker could submit an address and then try
 * to sign in with the password they had just chosen. Success meant the address
 * was new. No amount of response shaping closes that, because the difference
 * was genuinely there.
 *
 * Deferring activation removes the difference itself. Every submission does
 * the same thing, produces the same response, and leaves nothing behind that
 * can be probed. Which of the two messages goes out depends on whether the
 * address already has an account, and only the person holding that mailbox
 * ever sees which one arrived.
 *
 * WHAT REMAINS OBSERVABLE, DELIBERATELY
 *
 * Shape errors (a malformed address, a missing name) answer 400, because that
 * says nothing about who holds an account. Everything past validation answers
 * identically: signup disabled at the platform, closed at this institute,
 * address already registered, invitation suppressed by the resend cooldown,
 * and the ordinary success case are one response.
 */

export const dynamic = 'force-dynamic';

const UNIFORM_RESPONSE = {
  status: 'ok',
  message:
    'Check your email. If that address can be registered, a link is on its way.',
} as const;

type SignUpBody = {
  email?: unknown;
  firstName?: unknown;
  lastName?: unknown;
  answers?: unknown;
};

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
  const firstName =
    typeof body.firstName === 'string'
      ? body.firstName.trim().slice(0, 100)
      : '';
  const lastName =
    typeof body.lastName === 'string' ? body.lastName.trim().slice(0, 100) : '';
  const answers =
    typeof body.answers === 'object' && body.answers !== null
      ? (body.answers as Record<string, unknown>)
      : {};

  // Shape validation is safe to answer honestly: it says nothing about who
  // holds an account.
  if (!isPlausibleEmail(email) || !firstName || !lastName) {
    return NextResponse.json({ status: 'invalid' }, { status: 400 });
  }

  // Failures past this point are swallowed rather than surfaced. A 500 on one
  // branch and a 200 on another would rebuild the oracle out of error codes.
  try {
    await maybeInvite(tenant, { email, firstName, lastName, answers });
  } catch {
    // Nothing to report to the caller by design. An invitation that failed to
    // issue means no mail arrives, which is the same thing the caller sees
    // when the address is not one that can be registered here.
  }

  return NextResponse.json(UNIFORM_RESPONSE, { status: 200 });
}

async function maybeInvite(
  tenant: TenantContext,
  submission: {
    email: string;
    firstName: string;
    lastName: string;
    answers: Record<string, unknown>;
  },
): Promise<void> {
  // Two gates, both of which must agree. SELF_SERVE_SIGNUP is the platform
  // kill switch and signup_mode is the institute's own decision, so an
  // operator can stop every institute at once without editing anybody's
  // settings, and restoring the switch restores each institute's choice.
  if (!getEnv().SELF_SERVE_SIGNUP) return;
  if (!(await signupIsOpen(tenant.id))) return;

  const invitation = await issueInvitation({
    tenantId: tenant.id,
    host: tenant.host,
    email: submission.email,
    firstName: submission.firstName,
    lastName: submission.lastName,
    answers: submission.answers,
  });

  // Null means an invitation for this address was issued recently, so no
  // second message goes out. Silent on purpose: saying so would reveal that
  // one is already outstanding.
  if (!invitation) return;

  // The one place the account-existence answer is allowed to matter here, and
  // it decides only which words go to the address itself. See
  // findAccountByEmail for the rule that governs this.
  const known = (await findAccountByEmail(submission.email)) !== null;

  await sendMail(
    known
      ? existingAccountEmail({
          to: submission.email,
          institute: tenant.name,
          // The same activation link. Followed by somebody signed in as the
          // owner of this address, it joins them to the institute. Followed by
          // anybody else it asks for a password they do not have, so it is
          // safe to send and it saves the owner from repeating the signup.
          url: invitation.url,
        })
      : activationEmail({
          to: submission.email,
          firstName: submission.firstName,
          institute: tenant.name,
          url: invitation.url,
          expiresAt: invitation.expiresAt,
        }),
  );
}

async function signupIsOpen(tenantId: string): Promise<boolean> {
  const mode = await getTenantDb(tenantId).run(async (scope) => {
    const rows = await scope.tx
      .select({ signupMode: tenantSettings.signupMode })
      .from(tenantSettings)
      .where(eq(tenantSettings.tenantId, scope.tenantId))
      .limit(1);
    return rows[0]?.signupMode ?? 'closed';
  });

  return mode === 'open';
}

/**
 * Enough to reject a typo, not an attempt to validate addresses properly.
 * Whether an address exists is settled by whether the mail arrives, which is
 * the only check that is ever right.
 */
function isPlausibleEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(value) && value.length <= 320;
}
