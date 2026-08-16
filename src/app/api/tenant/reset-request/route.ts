import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/auth';
import { withSendingInstitute } from '@/lib/auth/sending-institute';
import { TtlCache } from '@/lib/cache/ttl-cache';
import { getTenant } from '@/lib/tenancy/context';

/**
 * Asking for a password reset.
 *
 * The same rule as signup governs this: the response says nothing about
 * whether the address holds an account. Better Auth's own endpoint is already
 * careful here, going as far as doing dummy work when the address is unknown so
 * the timing matches, and this route keeps that property rather than adding a
 * helpful error on top of it.
 *
 * It exists at all, rather than letting the browser call the auth endpoint
 * directly, for one reason: the link has to be built on this institute's
 * hostname. Better Auth has a single configured base URL and no idea which of
 * many hosts a request arrived on, so the tenant is established here and read
 * back in the sendResetPassword callback. See src/lib/auth/sending-institute.ts.
 */

export const dynamic = 'force-dynamic';

const UNIFORM_RESPONSE = {
  status: 'ok',
  message:
    'Check your email. If that address has an account, a link is on its way.',
} as const;

/**
 * Suppresses a second request for the same address for a few minutes.
 *
 * Without it the form is a way to make an institute mail somebody repeatedly by
 * typing an address you do not own. In memory rather than in the database on
 * purpose: this is a nuisance limiter rather than a security control, the
 * platform runs as a single instance (ADR 0004), and the worst case if it is
 * lost on restart is one extra message. The account-existence property does not
 * depend on it, since suppression is silent and the response never changes.
 */
const COOLDOWN_MS = 5 * 60 * 1000;
const recent = new TtlCache<true>(10_000, COOLDOWN_MS);

type ResetBody = { email?: unknown };

export async function POST(request: Request): Promise<NextResponse> {
  const tenant = await getTenant();
  if (!tenant) {
    return NextResponse.json({ status: 'not_found' }, { status: 404 });
  }

  let body: ResetBody;
  try {
    body = (await request.json()) as ResetBody;
  } catch {
    return NextResponse.json({ status: 'invalid' }, { status: 400 });
  }

  const email =
    typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!email.includes('@')) {
    return NextResponse.json({ status: 'invalid' }, { status: 400 });
  }

  // Keyed by institute as well as address, so one institute's form cannot
  // silently suppress another's.
  const key = `${tenant.id}:${email}`;

  if (!recent.get(key)) {
    recent.set(key, true);

    try {
      await withSendingInstitute({ host: tenant.host, name: tenant.name }, () =>
        getAuth().api.requestPasswordReset({ body: { email } }),
      );
    } catch {
      // Swallowed for the same reason signup swallows: an error on one branch
      // and a success on another would rebuild the account-existence oracle
      // out of status codes.
    }
  }

  return NextResponse.json(UNIFORM_RESPONSE, { status: 200 });
}
