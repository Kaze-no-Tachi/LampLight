import { afterAll, describe, expect, it } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import { getAdminDb } from '@/db/admin';
import { closeDb, getTenantDb } from '@/db/client';
import { findProgress } from '@/db/repositories/progress';
import { progress } from '@/db/schema';
import {
  CORNERSTONE,
  courseBySlug,
  firstGatedLesson,
  GRACE,
  userByKey,
} from '@/db/seed-data';
import { recordProgress } from '@/lib/player/progress';

/**
 * Where somebody got to, and who can see it.
 *
 * The interesting case is the shared student, who is a member of both
 * institutes and could plausibly be listening to a lesson at each. Their
 * position at one must be invisible to the other, and because the primary key
 * includes tenant_id, the two rows coexist rather than overwriting each other.
 */

const shared = userByKey(GRACE, 'shared');

/**
 * Hermeneutics, deliberately, because the fixture seeds this person's position
 * on old-testament-survey instead. Cleanup below deletes only these two rows,
 * so the seeded ones survive for the read path registry, which asserts against
 * them. A test that cleaned up by user id would delete them and break another
 * file, which has already happened once in this suite.
 */
function gracelesson(): string {
  return firstGatedLesson(courseBySlug(GRACE, 'hermeneutics')).id;
}

function cornerstoneLesson(): string {
  return firstGatedLesson(courseBySlug(CORNERSTONE, 'hermeneutics')).id;
}

async function clear(): Promise<void> {
  await getAdminDb()
    .delete(progress)
    .where(
      and(
        eq(progress.userId, shared.id),
        inArray(progress.lessonId, [gracelesson(), cornerstoneLesson()]),
      ),
    );
}

afterAll(async () => {
  await clear();
  await closeDb();
});

describe('recording a position', () => {
  it('keeps one position per institute for the same person', async () => {
    await clear();

    await getTenantDb(GRACE.id).run((scope) =>
      recordProgress(scope, {
        userId: shared.id,
        lessonId: gracelesson(),
        positionSeconds: 300,
        completed: false,
      }),
    );

    await getTenantDb(CORNERSTONE.id).run((scope) =>
      recordProgress(scope, {
        userId: shared.id,
        lessonId: cornerstoneLesson(),
        positionSeconds: 90,
        completed: false,
      }),
    );

    const atGrace = await getTenantDb(GRACE.id).run((scope) =>
      findProgress(scope, shared.id, gracelesson()),
    );
    const atCornerstone = await getTenantDb(CORNERSTONE.id).run((scope) =>
      findProgress(scope, shared.id, cornerstoneLesson()),
    );

    expect(atGrace?.positionSeconds).toBe(300);
    expect(atCornerstone?.positionSeconds).toBe(90);
  });

  it('does not answer for another institute lesson', async () => {
    // Both institutes have a lesson with this slug, so the id is a real row
    // somewhere. Asked for under the wrong scope, it must read as nothing.
    const row = await getTenantDb(GRACE.id).run((scope) =>
      findProgress(scope, shared.id, cornerstoneLesson()),
    );

    expect(row).toBeNull();
  });

  it('updates rather than duplicating', async () => {
    await clear();
    const lessonId = gracelesson();

    for (const seconds of [10, 200, 450]) {
      await getTenantDb(GRACE.id).run((scope) =>
        recordProgress(scope, {
          userId: shared.id,
          lessonId,
          positionSeconds: seconds,
          completed: false,
        }),
      );
    }

    const rows = await getAdminDb()
      .select({ position: progress.positionSeconds })
      .from(progress)
      .where(
        and(eq(progress.userId, shared.id), eq(progress.lessonId, lessonId)),
      );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.position).toBe(450);
  });

  it('keeps a lecture finished once it has been finished', async () => {
    // Somebody who listened to the end and then scrubbed back to hear a
    // section again has still listened to it. A progress mark that
    // un-completes itself gets reported as "it forgot".
    await clear();
    const lessonId = gracelesson();

    await getTenantDb(GRACE.id).run((scope) =>
      recordProgress(scope, {
        userId: shared.id,
        lessonId,
        positionSeconds: 1750,
        completed: true,
      }),
    );

    await getTenantDb(GRACE.id).run((scope) =>
      recordProgress(scope, {
        userId: shared.id,
        lessonId,
        positionSeconds: 120,
        completed: false,
      }),
    );

    const row = await getTenantDb(GRACE.id).run((scope) =>
      findProgress(scope, shared.id, lessonId),
    );

    expect(row?.positionSeconds).toBe(120);
    expect(row?.completedAt).not.toBeNull();
  });
});
