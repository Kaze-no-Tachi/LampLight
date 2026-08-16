// Loads .env and the test fallbacks. A static import, so it has run before
// the dynamic imports below reach any module that validates the environment.
import './env';

/**
 * Reseeds before the suite runs, so the isolation tests assert against known
 * fixture data no matter what state the local database was left in.
 *
 * Migrations are not run here. `pnpm db:migrate` is a separate, explicit step
 * in both the README and CI, because silently migrating a database as a side
 * effect of running tests is how someone eventually migrates the wrong one.
 */
export async function setup(): Promise<void> {
  const { seedDatabase } = await import('@/db/seed');
  const { closeAdminDb } = await import('@/db/admin');

  try {
    await seedDatabase();
  } catch (error) {
    throw new Error(
      'Could not seed the test database. Start the stack with ' +
        '`docker compose up -d` and apply migrations with `pnpm db:migrate` ' +
        `first.\n\nUnderlying error: ${String(error)}`,
    );
  } finally {
    await closeAdminDb();
  }
}
