import { eq } from 'drizzle-orm';
import { tenantSettings } from '@/db/schema';
import type { TenantScope } from '@/db/scope';

/**
 * Reads against tenant_settings: the row behind every page an institute
 * serves, and the questions it asks its own students.
 *
 * Returns the json columns unparsed. Parsing belongs to src/lib/theme and
 * src/lib/signup, which is where the allow-lists live, and doing it here would
 * mean two places decide what a valid theme or question list is.
 */

export type BrandingRow = {
  tenantId: string;
  logoUrl: string | null;
  faviconUrl: string | null;
  themeJson: unknown;
  copyJson: unknown;
  supportEmail: string | null;
  legalName: string | null;
};

export async function findBranding(
  scope: TenantScope,
): Promise<BrandingRow | null> {
  const rows = await scope.tx
    .select({
      tenantId: tenantSettings.tenantId,
      logoUrl: tenantSettings.logoUrl,
      faviconUrl: tenantSettings.faviconUrl,
      themeJson: tenantSettings.themeJson,
      copyJson: tenantSettings.copyJson,
      supportEmail: tenantSettings.supportEmail,
      legalName: tenantSettings.legalName,
    })
    .from(tenantSettings)
    // The primary key is the tenant id, so this filter is the whole lookup as
    // well as the isolation layer. Written explicitly all the same, because
    // the isolation suite runs this with RLS bypassed and a lookup that
    // depended on the policy would return the wrong institute's brand.
    .where(eq(tenantSettings.tenantId, scope.tenantId))
    .limit(1);

  return rows[0] ?? null;
}

/**
 * The questions this institute asks at signup, unparsed.
 *
 * Read separately from the branding row because the callers are different:
 * the signup form and the profile page need the question definitions, and
 * every page on the site needs the brand. Selecting one column when that is
 * what is wanted also keeps a large json blob off requests that never look at
 * it.
 */
export async function findSignupQuestions(
  scope: TenantScope,
): Promise<unknown> {
  const rows = await scope.tx
    .select({ questions: tenantSettings.signupQuestionsJson })
    .from(tenantSettings)
    .where(eq(tenantSettings.tenantId, scope.tenantId))
    .limit(1);

  return rows[0]?.questions ?? [];
}
