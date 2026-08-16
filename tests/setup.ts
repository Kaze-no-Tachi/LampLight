import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';

// Local runs read .env, CI injects real environment variables. .env.test wins
// where present so a developer cannot point the destructive test helpers at a
// development database by accident.
for (const file of ['.env.test', '.env']) {
  const path = resolve(process.cwd(), file);
  if (existsSync(path)) {
    loadEnv({ path, override: false });
  }
}
