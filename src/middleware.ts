import { NextResponse, type NextRequest } from 'next/server';
import { classifyHost, normalizeHost } from '@/lib/tenancy/host';

/**
 * Host-based routing (PRD section 5.2).
 *
 * WHAT THIS DOES NOT DO, AND WHY
 *
 * It does not touch the database. Middleware runs on the Edge runtime, which
 * cannot load the Postgres driver, and Node middleware is still experimental in
 * Next 15. So this layer answers only the question it can answer from the Host
 * header alone (is this the platform apex, or a tenant-shaped host) and rewrites
 * into the matching route group. Whether that tenant actually exists is decided
 * one layer down, in the tenant layout, which runs under Node and can query.
 *
 * The consequence worth knowing: an unknown host still reaches the application
 * rather than being rejected here. It gets a generic 404 from the tenant layout,
 * which is the same 404 a real tenant's missing page produces, so nothing about
 * which institutes exist leaks either way.
 */

const TENANT_HOST_HEADER = 'x-lamplight-host';
const TENANT_SLUG_HINT_HEADER = 'x-lamplight-slug-hint';
/**
 * The path and query as the visitor asked for it.
 *
 * A server component cannot see the request URL, only headers, and the
 * canonical-domain redirect has to preserve the whole path including a query
 * string, because activation and password reset links carry their token there.
 * Dropping it would turn every outstanding link into a dead end the first time
 * an institute changed its primary domain.
 */
const TENANT_PATH_HEADER = 'x-lamplight-path';

export const config = {
  // Static assets and image optimisation never need tenant context, and
  // running this on every one of them is wasted work on the hot path.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|robots.txt).*)'],
};

export function middleware(request: NextRequest): NextResponse {
  const apex = process.env.TENANT_SUBDOMAIN_ROOT ?? 'lamplight.school';
  const single = process.env.TENANCY_MODE === 'single';

  const host = normalizeHost(request.headers.get('host'));

  // Forward the normalized host so downstream code never re-parses the raw
  // header. One parser, one set of rules, no chance of the two disagreeing
  // about what `Grace.Lamplight.School.:443` means.
  const headers = new Headers(request.headers);
  if (host) headers.set(TENANT_HOST_HEADER, host);
  else headers.delete(TENANT_HOST_HEADER);
  headers.delete(TENANT_SLUG_HINT_HEADER);
  // Set from the parsed URL rather than forwarded from the client, so a
  // caller cannot choose where a redirect sends the next visitor.
  headers.set(
    TENANT_PATH_HEADER,
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
  );

  const forward = () => NextResponse.next({ request: { headers } });

  // Self-host mode pins one tenant, so every host is that tenant's and the
  // platform apex does not exist as a concept.
  if (single) return forward();

  if (!host) return forward();

  const classification = classifyHost(host, apex);

  if (classification.kind === 'subdomain') {
    headers.set(TENANT_SLUG_HINT_HEADER, classification.slug);
  }

  // The apex and a tenant both want to own "/", and Next.js will not let two
  // route groups claim the same path. So the apex home is a real route that
  // the apex is rewritten onto, leaving "/" free for the tenant. The rewrite
  // is internal, so the visitor's URL stays as it was.
  //
  // The rewrite is a routing convenience, not a security boundary: the page it
  // lands on guards itself with requireApex, because middleware cannot reach
  // the database and a guard beside the page cannot drift away from it.
  if (classification.kind === 'apex' && request.nextUrl.pathname === '/') {
    const url = request.nextUrl.clone();
    url.pathname = '/platform-home';
    return NextResponse.rewrite(url, { request: { headers } });
  }

  return forward();
}
