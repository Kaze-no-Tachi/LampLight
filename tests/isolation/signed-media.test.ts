import { afterAll, describe, expect, it } from 'vitest';
import { closeDb } from '@/db/client';
import {
  courseBySlug,
  CORNERSTONE,
  firstGatedLesson,
  GRACE,
  userByKey,
  type SeedTenant,
} from '@/db/seed-data';
import { issueLessonMedia } from '@/lib/access/media';
import { tenantPrefix } from '@/lib/storage/keys';
import type { StorageSigner } from '@/lib/storage';

/**
 * Signed media issuance (PRD requirement P0-9).
 *
 * A signed URL cannot be un-issued, which is what separates this from every
 * other gated read. A page rendered to the wrong person is a bug you fix and
 * redeploy; a URL handed to the wrong person is a bearer token in somebody's
 * browser history until it expires. So the assertions here are about what is
 * signed, not only about what is returned.
 */

/** Records what it was asked to sign, so the test can assert on it. */
function recordingSigner(): { signer: StorageSigner; signed: string[] } {
  const signed: string[] = [];
  return {
    signed,
    signer: {
      async signGet(request) {
        signed.push(request.key);
        return `https://storage.test/${request.key}?sig=fake`;
      },
      async signPut(request) {
        signed.push(request.key);
        return `https://storage.test/${request.key}?sig=fake&put=1`;
      },
      async head(key) {
        signed.push(key);
        return { byteSize: 1, contentType: 'audio/wav' };
      },
      async remove(key) {
        signed.push(key);
      },
    },
  };
}

function gatedLessonIn(tenant: SeedTenant, courseSlug: string): string {
  return firstGatedLesson(courseBySlug(tenant, courseSlug)).id;
}

afterAll(async () => {
  await closeDb();
});

describe('a URL is issued only after the predicate says yes', () => {
  it('issues for a student who is entitled', async () => {
    const { signer, signed } = recordingSigner();

    const media = await issueLessonMedia(
      { tenantId: GRACE.id, userId: userByKey(GRACE, 'student1').id },
      gatedLessonIn(GRACE, 'old-testament-survey'),
      signer,
    );

    expect(media).not.toBeNull();
    expect(media?.length).toBeGreaterThan(0);
    expect(signed.length).toBeGreaterThan(0);
  });

  it('signs nothing at all for a student who is not', async () => {
    const { signer, signed } = recordingSigner();

    const media = await issueLessonMedia(
      // student1 bought the diploma, which does not contain church-history.
      { tenantId: GRACE.id, userId: userByKey(GRACE, 'student1').id },
      gatedLessonIn(GRACE, 'church-history'),
      signer,
    );

    expect(media).toBeNull();
    // Not merely "returned nothing". Nothing was signed, so no URL exists
    // anywhere to be logged, cached, or leaked.
    expect(signed).toEqual([]);
  });

  it('signs nothing for a visitor with no session', async () => {
    const { signer, signed } = recordingSigner();

    const media = await issueLessonMedia(
      { tenantId: GRACE.id, userId: null },
      gatedLessonIn(GRACE, 'church-history'),
      signer,
    );

    expect(media).toBeNull();
    expect(signed).toEqual([]);
  });

  it('signs for a free preview even with no session', async () => {
    const preview = courseBySlug(GRACE, 'church-history')
      .modules.flatMap((courseModule) => courseModule.lessons)
      .find((lesson) => lesson.isFreePreview);
    if (!preview) throw new Error('fixture has no free preview lesson');

    const { signer, signed } = recordingSigner();

    const media = await issueLessonMedia(
      { tenantId: GRACE.id, userId: null },
      preview.id,
      signer,
    );

    expect(media).not.toBeNull();
    expect(signed.length).toBeGreaterThan(0);
  });
});

describe('a URL is never issued across institutes', () => {
  it('refuses another institute lesson id, and signs nothing', async () => {
    const { signer, signed } = recordingSigner();

    // Cornerstone's lesson, asked under Grace, by Grace's admin. The most
    // privileged role there is, and the answer is still nothing.
    const media = await issueLessonMedia(
      { tenantId: GRACE.id, userId: userByKey(GRACE, 'admin').id },
      gatedLessonIn(CORNERSTONE, 'old-testament-survey'),
      signer,
    );

    expect(media).toBeNull();
    expect(signed).toEqual([]);
  });

  it('only ever signs keys inside the asking institute prefix', async () => {
    const { signer, signed } = recordingSigner();

    await issueLessonMedia(
      { tenantId: GRACE.id, userId: userByKey(GRACE, 'admin').id },
      gatedLessonIn(GRACE, 'old-testament-survey'),
      signer,
    );

    expect(signed.length).toBeGreaterThan(0);
    for (const key of signed) {
      // The final backstop. Even if a resource row somehow carried another
      // institute's key, the signer refuses it, so this asserts the two
      // layers agree rather than trusting either alone.
      expect(key.startsWith(tenantPrefix(GRACE.id)), key).toBe(true);
      expect(key.startsWith(tenantPrefix(CORNERSTONE.id)), key).toBe(false);
    }
  });

  it('refuses to sign a key belonging to somebody else, whatever the caller says', async () => {
    const { signObjectRead } = await import('@/lib/storage');
    const { signer } = recordingSigner();

    // Directly, bypassing the predicate, to prove the storage layer does not
    // depend on its caller having been careful.
    await expect(
      signObjectRead(
        GRACE.id,
        `${tenantPrefix(CORNERSTONE.id)}lesson/abc/audio.mp3`,
        signer,
      ),
    ).rejects.toThrow(/outside the institute prefix/i);
  });
});

describe('what an issued URL carries', () => {
  it('expires, and soon', async () => {
    const { signer } = recordingSigner();

    const media = await issueLessonMedia(
      { tenantId: GRACE.id, userId: userByKey(GRACE, 'student1').id },
      gatedLessonIn(GRACE, 'old-testament-survey'),
      signer,
    );

    const first = media?.[0];
    expect(first).toBeDefined();
    if (!first) return;

    // A signed URL is a bearer token that cannot be revoked once issued, so
    // the only control over a leaked one is that it goes stale quickly.
    const lifetimeMs = first.expiresAt.getTime() - Date.now();
    expect(lifetimeMs).toBeGreaterThan(0);
    expect(lifetimeMs).toBeLessThanOrEqual(15 * 60 * 1000);
  });
});
