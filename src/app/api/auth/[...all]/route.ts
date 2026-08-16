import { getAuth } from '@/lib/auth';

/**
 * Better Auth's endpoints, mounted per tenant domain.
 *
 * The same handler answers on every institute's host, which is correct: the
 * identity tables are global, so signing in is the same operation everywhere.
 * What differs per host is authorization, and that is decided by the guards in
 * src/lib/auth/guards.ts, not here.
 *
 * The session cookie this sets is host-only, so it is never sent to another
 * institute's domain.
 *
 * getAuth is called inside the handlers rather than at module scope on
 * purpose. Anything evaluated at module scope runs while Next.js collects page
 * data during the build, where BETTER_AUTH_SECRET and the database URL do not
 * exist and should not be needed. Constructing at module scope made the build
 * demand production secrets, which is the same mistake that briefly made a
 * host-dependent page prerender.
 */

// Sessions are per request and must never be cached or prerendered.
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  return getAuth().handler(request);
}

export async function POST(request: Request): Promise<Response> {
  return getAuth().handler(request);
}
