import { NextResponse } from 'next/server';
import { checkDatabaseHealth } from '@/db/client';
import { getEnv } from '@/env';

/**
 * Liveness and readiness probe, used by the container HEALTHCHECK and by the
 * deploy pipeline to decide whether a release is actually serving.
 *
 * It checks that the database is reachable rather than only that the process is
 * up. A Next.js server will happily answer requests with an unreachable
 * database, so a process-only probe reports a green deploy while every page
 * renders an error.
 *
 * Configuration and database failures are reported as distinct reasons, and
 * that separation is load-bearing. Both of them surface at the same moment (the
 * first query on a cold container) and both used to be reported as "database
 * unreachable", which sends whoever is on the outage to inspect Postgres when
 * the real problem is a missing environment variable. The probe has to say
 * which of the two it is or it actively costs time during an incident.
 *
 * The response body carries no configuration detail. This endpoint is reachable
 * from the internet through the tunnel, so it names the category of failure and
 * nothing else. The specifics go to the server log, which is not public.
 */

// Never prerender or cache. A cached health check is not a health check.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(): Promise<NextResponse> {
  try {
    // Checked first and separately. If configuration is invalid, every
    // downstream check fails for a reason that has nothing to do with them.
    getEnv();
  } catch (error) {
    console.error('[health] invalid configuration:', error);
    return NextResponse.json(
      { status: 'unhealthy', reason: 'configuration' },
      { status: 503 },
    );
  }

  if (!(await checkDatabaseHealth())) {
    return NextResponse.json(
      { status: 'unhealthy', reason: 'database' },
      { status: 503 },
    );
  }

  return NextResponse.json({ status: 'ok', database: 'ok' }, { status: 200 });
}
