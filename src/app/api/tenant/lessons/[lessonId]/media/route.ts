import { NextResponse } from 'next/server';
import { issueLessonMedia } from '@/lib/access/media';
import { getSessionUser } from '@/lib/auth/guards';
import { storageConfigured } from '@/lib/storage';
import { getTenant } from '@/lib/tenancy/context';

/**
 * Where a player asks for playable URLs (PRD requirement P0-9).
 *
 * Every refusal is the same 404 with the same body. Wrong institute, no
 * session, no entitlement, expired enrollment, a lesson that never existed,
 * and a lesson id belonging to somebody else's institute all answer
 * identically, so a student cannot map a catalog by watching which ids
 * respond differently.
 *
 * No caching, ever. The response contains bearer URLs scoped to one person's
 * entitlement, and a shared cache holding those is exactly the leak the whole
 * signing scheme exists to prevent. `force-dynamic` covers the framework and
 * the explicit no-store header covers everything between here and the browser.
 */

export const dynamic = 'force-dynamic';

/** A fresh response each time, because a NextResponse is consumable. */
function notFound(): NextResponse {
  return NextResponse.json({ status: 'not_found' }, { status: 404 });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ lessonId: string }> },
): Promise<NextResponse> {
  const tenant = await getTenant();
  if (!tenant) return notFound();

  if (!storageConfigured()) return notFound();

  const { lessonId } = await params;
  const user = await getSessionUser();

  const media = await issueLessonMedia(
    { tenantId: tenant.id, userId: user?.id ?? null },
    lessonId,
  );

  // Null is every possible refusal. Undifferentiated on purpose.
  if (!media) return notFound();

  const response = NextResponse.json({ status: 'ok', media }, { status: 200 });
  response.headers.set('cache-control', 'private, no-store, max-age=0');
  return response;
}
