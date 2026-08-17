// Loads .env and the test fallbacks before anything that validates the
// environment is imported. Same file the vitest setup uses.
import './env';

/**
 * Reseeds before the browser suite runs.
 *
 * THE BUG THIS EXISTS TO PREVENT. There was no global setup here at all, so
 * the browser suite ran against whatever the previous command had left in the
 * database. Locally that was a hand-run seed and everything passed; in CI it
 * was the state the isolation suite finished in, seeded before the object
 * store existed, so every recording pointed at an object that was never
 * uploaded and the player tests failed on a fixture problem that looked like a
 * product problem.
 *
 * A suite that depends on fixture data has to create it. Playwright runs this
 * before the web server starts, so the server comes up against a database that
 * is already correct.
 */
export default async function globalSetup(): Promise<void> {
  const { seedDatabase } = await import('@/db/seed');
  const { closeAdminDb } = await import('@/db/admin');
  const { storageConfigured, statObject } = await import('@/lib/storage');
  const { getAdminDb } = await import('@/db/admin');
  const { lessonResources } = await import('@/db/schema');
  const { eq } = await import('drizzle-orm');

  try {
    await seedDatabase();

    // The seed reports an upload failure and carries on, because a developer
    // with no bucket still wants a working database. The browser suite is the
    // one caller that genuinely cannot proceed without the audio, so it checks
    // rather than trusting, and says which of the two things is wrong.
    if (!storageConfigured()) {
      throw new Error(
        'The browser suite plays real recordings, so it needs object ' +
          'storage. Start it with `docker compose up -d minio minio-init` ' +
          'and set the S3_* variables (see .env.example).',
      );
    }

    const [recording] = await getAdminDb()
      .select({
        tenantId: lessonResources.tenantId,
        storageKey: lessonResources.storageKey,
      })
      .from(lessonResources)
      .where(eq(lessonResources.kind, 'audio'))
      .limit(1);

    if (!recording?.storageKey) {
      throw new Error('the seed produced no audio resource to play');
    }

    // A missing object and an unreachable bucket are different problems with
    // the same consequence, and the raw error for the second one is a socket
    // message that says nothing about what the suite needed.
    const object = await statObject(
      recording.tenantId,
      recording.storageKey,
    ).catch((error: unknown) => {
      throw new Error(
        `could not reach object storage to check the seeded recordings: ` +
          `${String(error)}. Start it with \`docker compose up -d minio ` +
          'minio-init`.',
      );
    });

    if (!object) {
      throw new Error(
        `the seed wrote a recording row for ${recording.storageKey} but the ` +
          'object is not in the bucket, so the player would have nothing to ' +
          'play. Object storage has to be running before the seed, not just ' +
          'before the tests.',
      );
    }
  } finally {
    await closeAdminDb();
  }
}
