import { afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { getAdminDb } from '@/db/admin';
import { closeDb, getTenantDb } from '@/db/client';
import {
  listLessonResources,
  listResourcesForLessons,
} from '@/db/repositories/lessons';
import { lessonResources } from '@/db/schema';
import { courseBySlug, firstGatedLesson, GRACE } from '@/db/seed-data';

/**
 * An upload that was reserved and never finished.
 *
 * The row is written before the file is sent, so that a file which does arrive
 * always has something pointing at it. The cost is that a browser which dies
 * mid-upload leaves a row behind, and the rule that makes that harmless is:
 * byte_size stays null until the application has asked the bucket whether the
 * object is really there.
 *
 * These assert the consequence. A student is never offered a recording that
 * does not exist, and an instructor is shown it so they can try again.
 */

const RESERVED_ID = '00000000-0000-4000-8000-00000000f00d';

const lesson = firstGatedLesson(courseBySlug(GRACE, 'church-history'));

async function reserve(): Promise<void> {
  await getAdminDb()
    .insert(lessonResources)
    .values({
      id: RESERVED_ID,
      tenantId: GRACE.id,
      lessonId: lesson.id,
      kind: 'audio',
      storageKey: `t/${GRACE.id}/lesson/${RESERVED_ID}/never-arrived.mp3`,
      filename: 'never-arrived.mp3',
      // What requestUploadAction writes: a reservation, not a recording.
      byteSize: null,
      isDownloadable: false,
      sortOrder: 1,
    });
}

async function clear(): Promise<void> {
  await getAdminDb()
    .delete(lessonResources)
    .where(eq(lessonResources.id, RESERVED_ID));
}

afterAll(async () => {
  await clear();
  await closeDb();
});

describe('a reservation that never became a recording', () => {
  it('is not offered to a student', async () => {
    await clear();
    await reserve();

    const rows = await getTenantDb(GRACE.id).run((scope) =>
      listLessonResources(scope, lesson.id),
    );

    expect(rows.map((row) => row.id)).not.toContain(RESERVED_ID);
    // And the real one is still there, so this is a filter rather than a
    // query that returns nothing.
    expect(rows.length).toBeGreaterThan(0);
  });

  it('is shown to the instructor who has to fix it', async () => {
    const rows = await getTenantDb(GRACE.id).run((scope) =>
      listResourcesForLessons(scope, [lesson.id]),
    );

    const reserved = rows.find((row) => row.id === RESERVED_ID);
    expect(reserved).toBeDefined();
    expect(reserved?.byteSize).toBeNull();
  });
});
