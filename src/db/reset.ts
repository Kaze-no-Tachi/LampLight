import { pathToFileURL } from 'node:url';
import { sql } from 'drizzle-orm';
import { config as loadEnv } from 'dotenv';
import { closeAdminDb, getAdminDb } from './admin';
import { GLOBAL_TABLES, TENANT_OWNED_TABLES } from './tenant-tables';

loadEnv();

/**
 * Empties every application table. Migration history is left alone, so this is
 * a data reset rather than a schema teardown.
 *
 * Runs through the admin client because clearing every tenant at once is the
 * entire point, and because TRUNCATE is a table-level operation that
 * row-level security does not scope anyway.
 */
export async function resetData(): Promise<void> {
  const tables = [...TENANT_OWNED_TABLES, ...GLOBAL_TABLES].filter(
    (table) => table !== '__drizzle_migrations',
  );

  const identifiers = sql.join(
    tables.map((table) => sql.identifier(table)),
    sql`, `,
  );

  await getAdminDb().execute(sql`TRUNCATE TABLE ${identifiers} CASCADE`);
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'refusing to truncate application data with NODE_ENV=production',
    );
  }
  await resetData();
  console.log('all application data truncated');
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main()
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => closeAdminDb());
}
