import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { config as loadEnv } from 'dotenv';
import { closeAdminDb, getAdminDb } from './admin';

loadEnv();

/**
 * Migrations run as the owning role, not the application role, because the
 * application role has no DDL rights by design.
 */
async function main(): Promise<void> {
  const db = getAdminDb();

  await migrate(db, { migrationsFolder: './drizzle' });

  // Tables created by this run inherit grants from ALTER DEFAULT PRIVILEGES,
  // but that only applies when the migrating role matches the role the default
  // privileges were declared for. Re-granting here makes the migration work
  // regardless of how the database was provisioned, which matters for
  // self-hosters who did not use the compose file.
  const appRole = new URL(
    process.env.DATABASE_URL ?? 'postgres://lamplight_app@localhost/lamplight',
  ).username;

  if (appRole) {
    await db.execute(
      sql`
        GRANT USAGE ON SCHEMA public TO ${sql.identifier(appRole)};
        GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public
          TO ${sql.identifier(appRole)};
        GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public
          TO ${sql.identifier(appRole)};
      `,
    );
  }

  console.log('migrations applied');
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => closeAdminDb());
