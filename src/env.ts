import { z } from 'zod';

/**
 * Boot-time configuration. Nothing in the codebase reads process.env directly;
 * everything goes through this module so that a missing or malformed value
 * fails fast and loudly rather than at the first request that needs it.
 *
 * Phase policy: only the variables phase 1 actually consumes are required.
 * Later-phase variables are declared here (so .env.example stays honest and
 * so typos are caught) but stay optional until the phase that consumes them
 * lands, at which point they move into the required block. Feature code reads
 * them through `requireEnv`, which throws a targeted error instead of letting
 * an undefined value reach an API client.
 */

const postgresUrl = z
  .string()
  .min(1)
  .refine(
    (value) =>
      value.startsWith('postgres://') || value.startsWith('postgresql://'),
    { message: 'must be a postgres:// or postgresql:// connection string' },
  );

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),

  // Required from phase 1.
  // DATABASE_URL is the tenant-scoped role. It must NOT have BYPASSRLS, or the
  // second isolation layer is decorative. See docs/adr/0002.
  DATABASE_URL: postgresUrl,
  // DATABASE_ADMIN_URL is the migration and superadmin role. It bypasses RLS.
  DATABASE_ADMIN_URL: postgresUrl,
  DATABASE_POOL_MAX: z.coerce.number().int().positive().max(100).default(10),

  // Tenancy (phase 2). 'platform' resolves tenants from the Host header,
  // 'single' pins one tenant for self-hosters (PRD section 5.2).
  TENANCY_MODE: z.enum(['platform', 'single']).default('platform'),
  PLATFORM_APEX_DOMAIN: z.string().min(1).default('lectern.app'),
  TENANT_SUBDOMAIN_ROOT: z.string().min(1).default('lectern.app'),
  SINGLE_TENANT_SLUG: z.string().min(1).optional(),

  // Auth (phase 2).
  BETTER_AUTH_SECRET: z.string().min(32).optional(),
  BETTER_AUTH_URL: z.string().url().optional(),

  // Custom domains (phase 3).
  CLOUDFLARE_API_TOKEN: z.string().min(1).optional(),
  CLOUDFLARE_ZONE_ID: z.string().min(1).optional(),
  CLOUDFLARE_SAAS_FALLBACK_ORIGIN: z.string().min(1).optional(),

  // Object storage (phase 4). R2 in production, Minio locally.
  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().min(1).default('auto'),
  S3_BUCKET: z.string().min(1).optional(),
  S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  S3_FORCE_PATH_STYLE: z.coerce.boolean().default(false),
  SIGNED_URL_TTL_SECONDS: z.coerce.number().int().positive().default(300),

  // Payments (phase 6). 'connect' is the platform path, 'direct' is the
  // self-host path with no application fee (PRD section 8).
  PAYMENTS_MODE: z.enum(['connect', 'direct']).default('connect'),
  STRIPE_SECRET_KEY: z.string().min(1).optional(),
  STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
  STRIPE_CONNECT_CLIENT_ID: z.string().min(1).optional(),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Drops empty-string values so that a variable left blank in .env reads as
 * absent rather than as a zero-length value. .env.example ships later-phase
 * variables blank on purpose, and `FOO=` should not fail a min-length check on
 * an otherwise optional field.
 */
function withoutBlanks(source: NodeJS.ProcessEnv): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === 'string' && value.trim() !== '') {
      result[key] = value;
    }
  }
  return result;
}

function parseEnv(): Env {
  const parsed = envSchema.safeParse(withoutBlanks(process.env));

  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(
      `Invalid environment configuration:\n${detail}\n\n` +
        'Copy .env.example to .env and fill in the required values.',
    );
  }

  const value = parsed.data;

  if (value.TENANCY_MODE === 'single' && !value.SINGLE_TENANT_SLUG) {
    throw new Error(
      'Invalid environment configuration:\n' +
        '  SINGLE_TENANT_SLUG: required when TENANCY_MODE is "single"',
    );
  }

  if (value.DATABASE_URL === value.DATABASE_ADMIN_URL) {
    // Same connection string means the application runs as the RLS-bypassing
    // role, which silently removes the database isolation layer.
    throw new Error(
      'Invalid environment configuration:\n' +
        '  DATABASE_URL must not equal DATABASE_ADMIN_URL. The application role\n' +
        '  must be a distinct role without BYPASSRLS.',
    );
  }

  return value;
}

let cached: Env | null = null;

export function getEnv(): Env {
  cached ??= parseEnv();
  return cached;
}

/**
 * Reads a variable that is optional in the schema but required by the caller.
 * Use this at the point of consumption in later phases.
 */
export function requireEnv<K extends keyof Env>(key: K): NonNullable<Env[K]> {
  const value = getEnv()[key];
  if (value === undefined || value === null || value === '') {
    throw new Error(
      `Missing required environment variable ${String(key)}. ` +
        'See .env.example for the expected value.',
    );
  }
  return value as NonNullable<Env[K]>;
}
