import { eq } from 'drizzle-orm';
import { tenantSettings } from '@/db/schema';
import type { TenantScope } from '@/db/scope';

/**
 * Branding reads: the row behind every page an institute serves.
 *
 * Returns the json columns unparsed. Parsing belongs to src/lib/theme, which
 * is where the token allow-list lives, and putting it here would mean two
 * places decide what a valid theme is.
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
