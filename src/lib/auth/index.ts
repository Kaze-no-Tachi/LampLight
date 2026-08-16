import { randomUUID } from 'node:crypto';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { getEnv, requireEnv } from '@/env';
import * as schema from '@/db/schema';

/**
 * Better Auth, wired to the global identity tables (PRD section 5.4).
 *
 * WHY THIS OWNS ITS OWN POOL
 *
 * Every other query in the application runs through getTenantDb, which opens a
 * transaction and pins app.tenant_id so row-level security applies. Auth cannot
 * use it: sign-in happens before any tenant has been established, and the
 * tables it touches are global anyway, carrying no tenant_id and no policy.
 *
 * It still connects as the ordinary application role rather than the
 * RLS-bypassing admin role. Nothing here needs to cross a tenant boundary, so
 * nothing here gets the ability to.
 *
 * WHAT AUTHENTICATION DOES NOT GRANT
 *
 * A session says who someone is and nothing about which institute they may
 * see. Authorization is session plus a membership in the tenant resolved from
 * the Host header, which is enforced in src/lib/auth/guards.ts. Signing in at
 * one institute therefore gives no access at another, even for a person who
 * holds accounts at both.
 */

function createAuth() {
  const env = getEnv();

  const pool = new Pool({
    connectionString: env.DATABASE_URL,
    // Auth traffic is bursty and short-lived. A small dedicated pool keeps it
    // from competing with request rendering for the main pool's connections.
    max: 5,
  });

  return betterAuth({
    secret: requireEnv('BETTER_AUTH_SECRET'),

    database: drizzleAdapter(drizzle(pool, { schema }), {
      provider: 'pg',
      // Our tables are plural: users, sessions, accounts, verifications.
      usePlural: true,
      schema,
    }),

    emailAndPassword: {
      enabled: true,
      // Verification email delivery lands with the notifications work in P1.
      // Until then an unverified address can still sign in, which is fine for
      // a platform where an admin grants access rather than self-serve.
      requireEmailVerification: false,
      minPasswordLength: 12,
    },

    advanced: {
      database: {
        // Better Auth generates opaque string ids by default, and every id
        // column here is a uuid. Generating uuids keeps the column type honest
        // rather than widening it to text to accommodate the library.
        generateId: () => randomUUID(),
      },
      // No cookie domain is set, deliberately. A host-only cookie is not sent
      // to any other host, so a session minted at grace.lamplight.school is
      // never transmitted to cornerstone.lamplight.school. Setting a domain of
      // .lamplight.school would share one cookie across every institute on the
      // platform, which is exactly the cross-tenant leak this product cannot
      // have. Cross-subdomain cookies must stay off.
      crossSubDomainCookies: { enabled: false },
      useSecureCookies: env.NODE_ENV === 'production',
    },

    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
    },
  });
}

/**
 * Typed from createAuth rather than from betterAuth itself. The library's
 * return type is generic over the options object, so naming it through the
 * factory keeps the concrete instantiation instead of widening to the base
 * options type, which makes the adapter and the api surface disagree.
 */
type Auth = ReturnType<typeof createAuth>;

let cached: Auth | null = null;

export function getAuth(): Auth {
  cached ??= createAuth();
  return cached;
}

export type Session = Awaited<ReturnType<Auth['api']['getSession']>>;
