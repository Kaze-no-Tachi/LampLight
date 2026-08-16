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
  PLATFORM_APEX_DOMAIN: z.string().min(1).default('lamplight.school'),
  TENANT_SUBDOMAIN_ROOT: z.string().min(1).default('lamplight.school'),
  SINGLE_TENANT_SLUG: z.string().min(1).optional(),

  // Auth (phase 2).
  BETTER_AUTH_SECRET: z.string().min(32).optional(),
  /**
   * The platform kill switch for self-serve signup.
   *
   * This used to default to false, because signup created accounts and an
   * attacker could therefore submit an address and then test the password they
   * had just chosen: success meant the address was new. That is gone. Signup
   * now creates an invitation and mails a link, activating nothing, so there
   * is no longer anything to probe and no reason for the platform to refuse
   * the feature outright.
   *
   * Turning it on does not open signup anywhere. tenant_settings.signup_mode
   * is the institute's own decision and defaults to closed, and both gates
   * must agree. This one exists so an operator can stop every institute at
   * once without editing anybody's settings, and so that restoring it restores
   * each institute's choice rather than a blanket one.
   */
  SELF_SERVE_SIGNUP: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  BETTER_AUTH_URL: z.string().url().optional(),

  /**
   * Mail (phase 2, brought forward from P1).
   *
   * Delivery is not a notification feature here, it is part of account
   * creation: nothing activates until a link sent to the address is followed.
   * 'auto' picks SMTP when a host is configured, an in-memory outbox under
   * NODE_ENV=test, and a transport that logs the message otherwise, so a
   * developer can complete the flow without running a mail server.
   * Production refuses to serve without real SMTP, see assertPlatformConfig.
   */
  MAIL_TRANSPORT: z.enum(['auto', 'smtp', 'console', 'memory']).default('auto'),
  SMTP_HOST: z.string().min(1).optional(),
  SMTP_PORT: z.coerce.number().int().positive().max(65535).default(587),
  SMTP_USER: z.string().min(1).optional(),
  SMTP_PASSWORD: z.string().min(1).optional(),
  SMTP_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  MAIL_FROM: z.string().min(1).optional(),

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

  if (value.MAIL_TRANSPORT === 'smtp' && !value.SMTP_HOST) {
    throw new Error(
      'Invalid environment configuration:\n' +
        '  SMTP_HOST: required when MAIL_TRANSPORT is "smtp"',
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
 * Asserts the configuration the *application* needs to serve platform traffic.
 *
 * This is deliberately not part of parseEnv. Migration tooling, the seed
 * script, and the superadmin console all share this module, and none of them
 * touch Cloudflare. Enforcing it during parsing made every one of them refuse
 * to start in production, which broke the pre-deploy migration step that every
 * production release runs, for want of credentials it never uses.
 *
 * So the requirement lives with the process that actually has it. The app calls
 * this, tooling does not, and a misconfigured deployment still fails loudly:
 * the health probe reports `reason: "configuration"` and the container never
 * goes healthy, so `docker compose up --wait` and Dokploy both refuse the
 * release rather than serving a broken one.
 */
export function assertPlatformConfig(): void {
  const value = getEnv();

  if (value.NODE_ENV !== 'production') return;

  // Mail is required in every production deployment, self-host included.
  // Account creation ends at a link sent to the address, so an instance
  // without a transport can issue invitations that nobody can ever act on.
  // Refusing to serve is better than accepting signups into a void.
  //
  // Scoped to MAIL_TRANSPORT=auto, which is the default and therefore the
  // accident being guarded against: deploying without thinking about mail. An
  // explicit MAIL_TRANSPORT is somebody saying what they want, which is a
  // reasonable thing to allow for a staging box or a test server. The mail
  // module logs a warning in that case, so it is loud without being fatal.
  if (
    value.MAIL_TRANSPORT === 'auto' &&
    (!value.SMTP_HOST || !value.MAIL_FROM)
  ) {
    throw new Error(
      'Invalid environment configuration:\n' +
        (!value.SMTP_HOST ? '  SMTP_HOST: required in production\n' : '') +
        (!value.MAIL_FROM ? '  MAIL_FROM: required in production\n' : '') +
        '\nAccount activation depends on mail delivery. See docs/runbook.md.',
    );
  }

  if (value.TENANCY_MODE !== 'platform') return;

  const missing = (
    [
      'CLOUDFLARE_API_TOKEN',
      'CLOUDFLARE_ZONE_ID',
      'CLOUDFLARE_SAAS_FALLBACK_ORIGIN',
    ] as const
  ).filter((key) => !value[key]);

  if (missing.length > 0) {
    throw new Error(
      'Invalid environment configuration:\n' +
        missing
          .map(
            (key) =>
              `  ${key}: required when TENANCY_MODE is "platform" in production`,
          )
          .join('\n'),
    );
  }
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
