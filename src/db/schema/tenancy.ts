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
 * Note the deliberate exception to the "every unique constraint is composite
 * with tenant_id" rule: `hostname` is unique platform-wide, not per tenant.
 * A hostname resolves to exactly one tenant, so scoping that constraint by
 * tenant would let two tenants both claim institute.edu and make Host-header
 * resolution ambiguous. See docs/adr/0001.
 */
export const tenantDomains = pgTable(
  'tenant_domains',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    hostname: text('hostname').notNull().unique(),
    isPrimary: boolean('is_primary').notNull().default(false),
    verificationStatus: domainVerificationStatus('verification_status')
      .notNull()
      .default('pending'),
    cfHostnameId: text('cf_hostname_id'),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('tenant_domains_tenant_id_id_key').on(table.tenantId, table.id),
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
