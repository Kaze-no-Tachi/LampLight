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

/**
 * Holds the most recent password-setup link per address, briefly.
 *
 * This exists only because there is no mail transport yet. It is deliberately
 * short-lived and in-process, which means it works for an operator clicking
 * provision on a single instance and would not survive a restart or a second
 * replica. That limitation is acceptable for the one flow that uses it, and it
 * disappears entirely once sendResetPassword actually sends.
 */
const setupLinks = new Map<string, { url: string; expiresAt: number }>();
const SETUP_LINK_TTL_MS = 60_000;

function stashSetupLink(email: string, url: string): void {
  setupLinks.set(email.toLowerCase(), {
    url,
    expiresAt: Date.now() + SETUP_LINK_TTL_MS,
  });
}

/** Reads and clears the link. Single use, so it cannot be replayed. */
export function takeSetupLink(email: string): string | null {
  const key = email.toLowerCase();
  const entry = setupLinks.get(key);
  setupLinks.delete(key);
  if (!entry || entry.expiresAt <= Date.now()) return null;
  return entry.url;
}

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

      /**
       * Captures the reset link instead of emailing it.
       *
       * Provisioning needs to hand a new institute admin a way to set their
       * own password, and there is no mail transport yet. Rather than invent a
       * second token scheme, this reuses Better Auth's tested reset flow and
       * intercepts the URL so the operator can pass it on out of band.
       *
       * When mail delivery lands this callback sends instead of stashing, and
       * nothing else about the flow changes.
       */
      sendResetPassword: async ({ user, url }) => {
        stashSetupLink(user.email, url);
      },
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
