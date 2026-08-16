import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

loadEnv();

const url = process.env.DATABASE_ADMIN_URL;

if (!url) {
  throw new Error(
    'DATABASE_ADMIN_URL is required for drizzle-kit. Migrations run as the ' +
      'owning role, not the application role.',
  );
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
