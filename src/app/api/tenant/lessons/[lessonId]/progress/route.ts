import { NextResponse } from 'next/server';
import { getTenantDb } from '@/db/client';
import { findProgress } from '@/db/repositories/progress';
import { recordProgress } from '@/lib/player/progress';
import { decideLessonAccess } from '@/lib/access/predicate';
import { getSessionUser } from '@/lib/auth/guards';
import { clampPosition } from '@/lib/player/track';
import { getTenant } from '@/lib/tenancy/context';

/**
 * Where the player says how far somebody has got (PRD requirement P0-8).
 *
 * Behind the same predicate as the media itself, and for the same reason: this
 * is a write keyed on a lesson id, and without the check anybody could write
 * rows against lesson ids at any institute. It would not leak content, but it
 * would let a stranger fill another institute's progress table, and the id
 * confirmed-or-not would be an oracle for which lessons exist.
 *
 * Every refusal is the same 404 with the same body, matching the media route.
 *
 * A free preview is playable without an account, so a request with no session
 * passes the predicate and then has nowhere to store anything. That answers ok
 * and writes nothing, rather than 401: the player is not broken, there is
 * simply no one to remember.
 */

export const dynamic = 'force-dynamic';

function notFound(): NextResponse {
  return NextResponse.json({ status: 'not_found' }, { status: 404 });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ lessonId: string }> },
): Promise<NextResponse> {
  const tenant = await getTenant();
  if (!tenant) return notFound();

  const { lessonId } = await params;
  const user = await getSessionUser();
  const ctx = { tenantId: tenant.id, userId: user?.id ?? null };

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ status: 'bad_request' }, { status: 400 });
  }

  const position = readPosition(body);
  if (position === null) {
    return NextResponse.json({ status: 'bad_request' }, { status: 400 });
  }

  const completed =
    typeof body === 'object' &&
    body !== null &&
    (body as { completed?: unknown }).completed === true;

  const stored = await getTenantDb(tenant.id).run(async (scope) => {
    const decision = await decideLessonAccess(scope, ctx, lessonId);
    if (!decision.allowed) return null;

    // Anonymous listener on a free preview. Allowed to listen, nothing to save.
    if (!ctx.userId) return false;

    await recordProgress(scope, {
      userId: ctx.userId,
      lessonId,
      positionSeconds: position,
      completed,
    });
    return true;
  });

  if (stored === null) return notFound();

  const response = NextResponse.json({ status: 'ok', stored }, { status: 200 });
  response.headers.set('cache-control', 'private, no-store, max-age=0');
  return response;
}

/** Reads how far in, or null when the body is not saying. See clampPosition. */
function readPosition(body: unknown): number | null {
  if (typeof body !== 'object' || body === null) return null;
  return clampPosition((body as { positionSeconds?: unknown }).positionSeconds);
}

/**
 * Where the player asks what position to resume from.
 *
 * Behind the predicate as well, so that a GET cannot be used to ask whether a
 * lesson id exists at another institute.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ lessonId: string }> },
): Promise<NextResponse> {
  const tenant = await getTenant();
  if (!tenant) return notFound();

  const { lessonId } = await params;
  const user = await getSessionUser();
  const ctx = { tenantId: tenant.id, userId: user?.id ?? null };

  const result = await getTenantDb(tenant.id).run(async (scope) => {
    const decision = await decideLessonAccess(scope, ctx, lessonId);
    if (!decision.allowed) return null;
    if (!ctx.userId) return { positionSeconds: 0, completed: false };

    const row = await findProgress(scope, ctx.userId, lessonId);
    return {
      positionSeconds: row?.positionSeconds ?? 0,
      completed: row?.completedAt !== null && row?.completedAt !== undefined,
    };
  });

  if (!result) return notFound();

  const response = NextResponse.json({ status: 'ok', ...result });
  response.headers.set('cache-control', 'private, no-store, max-age=0');
  return response;
}
