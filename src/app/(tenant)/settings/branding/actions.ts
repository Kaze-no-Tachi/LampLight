'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { getTenantDb } from '@/db/client';
import { auditLog, tenantSettings } from '@/db/schema';
import { requireRole } from '@/lib/auth/guards';
import { safeAssetUrl } from '@/lib/theme/assets';
import { COPY_KEYS, parseCopy, serializeCopy } from '@/lib/theme/copy';
import {
  normalizeColor,
  normalizeRadius,
  parseTheme,
  serializeTheme,
  THEME_PRESETS,
} from '@/lib/theme/theme';

/**
 * Saving an institute's brand, admin only.
 *
 * Everything submitted is re-validated here rather than trusted from the form.
 * A server action is a public endpoint that happens to be called from a page,
 * so the colour pickers and length limits in the form are conveniences for the
 * person, not constraints on the request.
 */

export type SaveResult =
  { status: 'ok' } | { status: 'error'; message: string };

export async function saveBrandingAction(
  formData: FormData,
): Promise<SaveResult> {
  const viewer = await requireRole('admin');

  const presetInput = String(formData.get('preset') ?? '');
  const preset = THEME_PRESETS.find((name) => name === presetInput);
  if (!preset) return { status: 'error', message: 'Unknown preset.' };

  // Empty means "use the preset's value", which is different from an invalid
  // colour: an invalid one is reported so the admin can fix their typo rather
  // than wonder why nothing changed.
  const colors: Record<string, string | null> = {};
  for (const field of ['brand', 'accent', 'background'] as const) {
    const raw = String(formData.get(field) ?? '').trim();
    if (!raw) {
      colors[field] = null;
      continue;
    }
    const normalized = normalizeColor(raw);
    if (!normalized) {
      return {
        status: 'error',
        message: `${field} is not a colour. Use a hex value like #1f3a5f.`,
      };
    }
    colors[field] = normalized;
  }

  const radiusRaw = String(formData.get('radius') ?? '').trim();
  const radius = radiusRaw ? normalizeRadius(radiusRaw) : null;
  if (radiusRaw && !radius) {
    return {
      status: 'error',
      message: 'Corner radius must be between 0 and 2.',
    };
  }

  const logoRaw = String(formData.get('logoUrl') ?? '').trim();
  const logoUrl = logoRaw ? safeAssetUrl(logoRaw) : null;
  if (logoRaw && !logoUrl) {
    return {
      status: 'error',
      message: 'The logo address must be an https URL.',
    };
  }

  const copyInput: Record<string, unknown> = {};
  for (const key of COPY_KEYS) {
    copyInput[key] = String(formData.get(key) ?? '');
  }

  const theme = serializeTheme(
    parseTheme({
      preset,
      brand: colors.brand,
      accent: colors.accent,
      background: colors.background,
      radius,
    }),
  );
  const copy = serializeCopy(parseCopy(copyInput));

  await getTenantDb(viewer.tenant.id).run(async (scope) => {
    await scope.tx
      .update(tenantSettings)
      .set({
        themeJson: theme,
        copyJson: copy,
        logoUrl,
        updatedAt: new Date(),
      })
      .where(eq(tenantSettings.tenantId, scope.tenantId));

    // Not a security decision, but it is the sort of change that happens and
    // then nobody remembers making, and the audit trail is cheap.
    await scope.tx.insert(auditLog).values({
      tenantId: scope.tenantId,
      actorUserId: viewer.userId,
      action: 'settings.branding_changed',
      targetType: 'tenant_settings',
      targetId: scope.tenantId,
      metadataJson: { preset, hasLogo: logoUrl !== null },
    });
  });

  // The theme is in the layout, so it is on every page under it.
  revalidatePath('/', 'layout');
  return { status: 'ok' };
}
