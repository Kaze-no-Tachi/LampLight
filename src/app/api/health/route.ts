import { NextResponse } from 'next/server';
import { checkDatabaseHealth } from '@/db/client';

/**
 * Liveness and readiness probe, used by the container HEALTHCHECK and by the
 * deploy pipeline to decide whether a release is actually serving.
 *
 * It deliberately checks that the database is reachable rather than only that
 * the process is up. A Next.js server will happily answer requests with an
 * unreachable database, so a process-only probe reports a green deploy while
 * every page renders an error.
 *
 * The response body carries no configuration detail. This endpoint is reachable
 * from the internet through the tunnel, so it says whether the service is
 * healthy and nothing about why it is not.
 */

// Never prerender or cache. A cached health check is not a health check.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(): Promise<NextResponse> {
  const databaseReachable = await checkDatabaseHealth();

  if (!databaseReachable) {
    return NextResponse.json(
      { status: 'unhealthy', database: 'unreachable' },
      { status: 503 },
    );
  }

  return NextResponse.json({ status: 'ok', database: 'ok' }, { status: 200 });
}
