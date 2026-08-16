import { getTenantDb } from '@/db/client';
import { findBranding } from '@/db/repositories/branding';
import type { TenantContext } from '@/lib/tenancy/resolve';
import { safeAssetUrl } from './assets';
import {
  copyFor,
  EMPTY_COPY,
  parseCopy,
  type CopyKey,
  type CopySettings,
} from './copy';
import { DEFAULT_THEME, parseTheme, type ThemeSettings } from './theme';

/**
 * Everything the chrome needs to render one institute, resolved once per
 * request and passed down rather than re-read per component.
 */
export type Branding = {
  /** The institute's display name, which is not editable here. */
  name: string;
  theme: ThemeSettings;
  /** Copy with defaults applied, for rendering. */
  copy: Record<CopyKey, string>;
  /** Copy as stored, for the settings form to show what has been written. */
  written: CopySettings;
  logoUrl: string | null;
  faviconUrl: string | null;
  supportEmail: string | null;
  legalName: string | null;
};

/** Loose on purpose: this only decides whether to render a mailto link. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function loadBranding(tenant: TenantContext): Promise<Branding> {
  const row = await getTenantDb(tenant.id).run((scope) => findBranding(scope));

  // A tenant with no settings row is a tenant mid-creation, not an error. It
  // gets the default preset and the generated copy, which is a working page.
  if (!row) {
    return {
      name: tenant.name,
      theme: DEFAULT_THEME,
      copy: copyFor(tenant.name, EMPTY_COPY),
      written: EMPTY_COPY,
      logoUrl: null,
      faviconUrl: null,
      supportEmail: null,
      legalName: null,
    };
  }

  const written = parseCopy(row.copyJson);

  return {
    name: tenant.name,
    theme: parseTheme(row.themeJson),
    copy: copyFor(tenant.name, written),
    written,
    logoUrl: safeAssetUrl(row.logoUrl),
    faviconUrl: safeAssetUrl(row.faviconUrl),
    supportEmail:
      row.supportEmail && EMAIL.test(row.supportEmail)
        ? row.supportEmail
        : null,
    legalName: row.legalName,
  };
}
