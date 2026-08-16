import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { domainVerificationStatus, signupMode, tenantStatus } from './enums';

/**
 * The tenant root. This is the only table that is not itself tenant-scoped,
 * and it is the target of the tenant_id foreign key on every other
 * tenant-owned table.
 */
export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  status: tenantStatus('status').notNull().default('pending'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Custom hostnames.
 *
 * UNIQUENESS APPLIES TO VERIFIED DOMAINS, NOT TO CLAIMS.
 *
 * A hostname must resolve to exactly one institute, so two tenants cannot both
 * hold `institute.edu` as active. That is enforced by a partial unique index
 * over rows whose verification_status is 'active' (migration 0006), not by a
 * plain unique on the column.
 *
 * The difference is the whole point. A plain unique made a *claim* exclusive
 * from the moment it was typed, so any institute could enter a competitor's
 * domain and permanently block them from ever attaching it, without owning
 * anything and without the platform being able to tell. Now a claim blocks
 * nobody: several institutes may hold a pending row for the same name, and the
 * one that proves ownership through DNS is the one that gets it.
 *
 * Pending claims also expire (claim_expires_at), which is what stops an
 * abandoned or speculative claim from holding a slot at Cloudflare, where the
 * custom hostname record genuinely is exclusive. See docs/adr/0001.
 */
export const tenantDomains = pgTable(
  'tenant_domains',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    hostname: text('hostname').notNull(),
    isPrimary: boolean('is_primary').notNull().default(false),
    verificationStatus: domainVerificationStatus('verification_status')
      .notNull()
      .default('pending'),
    cfHostnameId: text('cf_hostname_id'),
    /**
     * The DNS records the institute has to create, exactly as Cloudflare
     * described them. Stored rather than re-fetched so the settings page can
     * show them without an API call on every view, and so they survive
     * Cloudflare being briefly unreachable while somebody is mid-setup.
     */
    dnsRecordsJson: jsonb('dns_records_json').notNull().default([]),
    /**
     * When an unverified claim lapses. Null once verified, because a live
     * domain does not expire.
     *
     * This is what keeps a speculative claim from holding a name forever at
     * Cloudflare, where the custom hostname record is genuinely exclusive even
     * though ours no longer is.
     */
    claimExpiresAt: timestamp('claim_expires_at', { withTimezone: true }),
    /** Why verification failed, for the settings page. Never shown to visitors. */
    lastError: text('last_error'),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('tenant_domains_tenant_id_id_key').on(table.tenantId, table.id),
    // One institute may not claim the same hostname twice, which would leave
    // the settings page showing a duplicate and the sweep updating one row at
    // random. Different institutes claiming the same name is allowed until one
    // of them verifies it, which is the point of the partial index in 0006.
    unique('tenant_domains_tenant_id_hostname_key').on(
      table.tenantId,
      table.hostname,
    ),
  ],
);

/**
 * Branding and copy. theme_json holds design tokens rendered into CSS custom
 * properties at request time, copy_json holds institute-specific strings
 * (PRD section 9).
 */
export const tenantSettings = pgTable('tenant_settings', {
  tenantId: uuid('tenant_id')
    .primaryKey()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  logoUrl: text('logo_url'),
  faviconUrl: text('favicon_url'),
  themeJson: jsonb('theme_json').notNull().default({}),
  copyJson: jsonb('copy_json').notNull().default({}),
  supportEmail: text('support_email'),
  timezone: text('timezone').notNull().default('America/Indiana/Indianapolis'),
  legalName: text('legal_name'),
  /**
   * Whether this institute takes self-serve signups. Closed unless the
   * institute turns it on, because an institute that has not thought about
   * who may enrol should not be accepting strangers by default.
   *
   * This is the second of two gates. SELF_SERVE_SIGNUP is the platform kill
   * switch and this is the per-institute choice, and signup happens only when
   * both agree. An operator can therefore stop every institute at once without
   * editing any institute's settings, and restoring the switch restores each
   * institute's own decision rather than a blanket one.
   */
  signupMode: signupMode('signup_mode').notNull().default('closed'),
  /**
   * Extra questions asked at signup, beyond name and email.
   *
   * Answers are institute-specific and land on the membership, never on the
   * global users row. Grace asking for a home congregation must not follow the
   * person to Cornerstone. The definitions live here so each institute owns
   * its own intake form; rendering them is later-phase work, and until then
   * this stays an empty array and the form asks for a name.
   */
  signupQuestionsJson: jsonb('signup_questions_json').notNull().default([]),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Stripe Connect state. A product cannot be published until charges_enabled
 * is true (PRD section 8). application_fee_bps is per tenant so design
 * partners can sit at zero.
 */
export const tenantBilling = pgTable('tenant_billing', {
  tenantId: uuid('tenant_id')
    .primaryKey()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  stripeAccountId: text('stripe_account_id'),
  chargesEnabled: boolean('charges_enabled').notNull().default(false),
  payoutsEnabled: boolean('payouts_enabled').notNull().default(false),
  applicationFeeBps: integer('application_fee_bps').notNull().default(0),
  onboardedAt: timestamp('onboarded_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});
