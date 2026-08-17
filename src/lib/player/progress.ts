import { sql } from 'drizzle-orm';
import { progress } from '@/db/schema';
import type { TenantScope } from '@/db/scope';

/**
 * Writing where somebody got to.
 *
 * Deliberately not in src/db/repositories, which holds read paths only: the
 * isolation suite enumerates that directory and runs every export under the
 * wrong tenant to prove it returns nothing. A write does not fit that shape,
 * and putting one there would either weaken the registry or add an entry that
 * writes rows during a read test.
 *
 * Takes a TenantScope rather than a tenant id so the caller can run the access
 * check and this write in one transaction.
 */

/**
 * Writes where somebody got to.
 *
 * An upsert rather than a read-then-write, because a player sends these every
 * few seconds from however many tabs are open, and two of them racing must not
 * turn into a lost row or a constraint violation.
 *
 * Nothing here decides whether this person may listen. The caller does that
 * with the access predicate, before calling, because a progress write is a
 * write against a lesson and the predicate is the single authority on whether
 * a lesson is theirs to touch.
 */
export async function recordProgress(
  scope: TenantScope,
  params: {
    userId: string;
    lessonId: string;
    positionSeconds: number;
    completed: boolean;
  },
): Promise<void> {
  const now = new Date();

  await scope.tx
    .insert(progress)
    .values({
      tenantId: scope.tenantId,
      userId: params.userId,
      lessonId: params.lessonId,
      positionSeconds: params.positionSeconds,
      completedAt: params.completed ? now : null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [progress.tenantId, progress.userId, progress.lessonId],
      set: {
        positionSeconds: params.positionSeconds,
        // Completion is sticky. Somebody who finished a lecture and then
        // scrubbed back to hear a section again has still finished it, and a
        // progress bar that un-completes itself on a re-listen is a bug people
        // report as "it forgot".
        completedAt: params.completed ? now : sql`${progress.completedAt}`,
        updatedAt: now,
      },
    });
}
