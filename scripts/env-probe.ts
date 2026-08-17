/**
 * Loads the environment the way the application does, and says so or fails.
 *
 * Run as a child process by scripts/check-env.ts with only the variables from
 * the file under test. Separate from that script so the parsing runs in a
 * process that has nothing else in its environment: importing the env module
 * in-process would validate the developer's shell instead.
 */
import { assertPlatformConfig, getEnv } from '../src/env';

try {
  const env = getEnv();
  assertPlatformConfig();
  console.log(`NODE_ENV=${env.NODE_ENV}, TENANCY_MODE=${env.TENANCY_MODE}`);
} catch (error) {
  // The message, not the stack. Somebody checking an environment file wants to
  // know which variable is wrong, and a trace through the validator is noise
  // between them and the answer.
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
