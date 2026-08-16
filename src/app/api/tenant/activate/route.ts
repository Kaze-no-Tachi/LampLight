import { NextResponse } from 'next/server';
import { findAccountByEmail } from '@/db/client';
import { getAuth } from '@/lib/auth';
import {
  completeActivation,
  findPendingInvitation,
  type PendingInvitation,
} from '@/lib/auth/invitations';
import { getSessionUser } from '@/lib/auth/guards';
import { getTenant } from '@/lib/tenancy/context';

/**
 * Where an invitation becomes an account.
 *
 * Possession of the token is the credential, and it proves one thing: control
 * of the mailbox it was sent to. That is exactly the claim email verification
 * makes, which is why activation marks the address verified rather than
 * sending a second confirmation to the address that just confirmed itself.
 *
 * THREE CASES, AND WHY THE THIRD IS NOT A SHORTCUT
 *
 *   No account for this address
 *     Create it with the password chosen here, then join them to the
 *     institute. The ordinary path.
 *
 *   An account exists and its address is verified
 *     Nothing happens without a session belonging to that address. Anything
 *     else would let whoever holds the link attach themselves to an
 *     established account, trading an information leak for account takeover.
 *     The link was mailed to the address itself, so its legitimate owner can
 *     sign in and follow it again, which is what the response asks for.
 *
 *   An account exists and its address is NOT verified
 *     Resume, with no password and no session. This is the state left behind
 *     if the process died between creating the account and writing the
 *     membership, and the password on it is the one this same person chose on
 *     their previous attempt. Completing it grants nothing the first case
 *     would not have granted a moment earlier. Without this branch that person
 *     is stuck permanently: they cannot sign in, because the address is
 *     unverified, and they cannot activate, because the account exists.
 */

export const dynamic = 'force-dynamic';

const MIN_PASSWORD_LENGTH = 12;

const REFUSED = {
  status: 'error',
  message: 'That link is no longer usable. Ask for a new one.',
} as const;

type ActivateBody = { token?: unknown; password?: unknown };

export async function POST(request: Request): Promise<NextResponse> {
  const tenant = await getTenant();
  if (!tenant) {
    return NextResponse.json({ status: 'not_found' }, { status: 404 });
  }

  let body: ActivateBody;
  try {
    body = (await request.json()) as ActivateBody;
  } catch {
    return NextResponse.json(REFUSED, { status: 400 });
  }

  const token = typeof body.token === 'string' ? body.token : '';
  const password = typeof body.password === 'string' ? body.password : '';

  const invitation = await findPendingInvitation(tenant.id, token);
  if (!invitation) {
    return NextResponse.json(REFUSED, { status: 400 });
  }

  const account = await findAccountByEmail(invitation.email);

  if (!account) {
    return activateNewAccount(tenant.id, invitation, password);
  }

  // Case two, resolved in the holder's favour when they are already signed in
  // as the owner of this address.
  const session = await getSessionUser();
  if (session && session.email.toLowerCase() === invitation.email) {
    return finish(tenant.id, invitation.id, session.id, 'joined');
  }

  if (account.emailVerified) {
    // Established account, no session. Not a refusal: they are looking at a
    // link that was mailed to them, and a dead end here is a support call.
    return NextResponse.json({ status: 'sign_in_required' }, { status: 200 });
  }

  // Case three.
  return finish(tenant.id, invitation.id, account.id, 'activated');
}

async function activateNewAccount(
  tenantId: string,
  invitation: PendingInvitation,
  password: string,
): Promise<NextResponse> {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json(
      {
        status: 'error',
        message: `Choose a password of at least ${MIN_PASSWORD_LENGTH} characters.`,
      },
      { status: 400 },
    );
  }

  const created = await getAuth().api.signUpEmail({
    body: {
      email: invitation.email,
      password,
      // Better Auth requires a name. The invitation's is authoritative and
      // gets written again by completeActivation, so this is only a fallback
      // for an invitation that carried no name at all.
      name:
        [invitation.firstName, invitation.lastName].filter(Boolean).join(' ') ||
        invitation.email,
    },
    asResponse: false,
  });

  const userId = created?.user?.id;
  if (!userId) return NextResponse.json(REFUSED, { status: 400 });

  return finish(tenantId, invitation.id, userId, 'activated');
}

/**
 * Spends the invitation and joins the institute.
 *
 * A false return means the row was consumed between the lookup and here, which
 * is two clicks racing. Only one can win, and the loser is correctly told the
 * link is spent.
 */
async function finish(
  tenantId: string,
  invitationId: string,
  userId: string,
  status: 'activated' | 'joined',
): Promise<NextResponse> {
  const done = await completeActivation({ tenantId, invitationId, userId });

  return done
    ? NextResponse.json({ status }, { status: 200 })
    : NextResponse.json(REFUSED, { status: 400 });
}
