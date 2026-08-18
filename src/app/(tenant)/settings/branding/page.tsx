import { requireRole } from '@/lib/auth/guards';
import { loadBranding } from '@/lib/theme/branding';
import { BrandingForm } from './branding-form';

/**
 * What the institute looks like and what it says (mockup 11, PRD section 9,
 * P0-12).
 *
 * Admin only, denied with 404 like every other guard, so an instructor or
 * somebody signed in at another institute sees what a stranger sees.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Branding' };

export default async function BrandingSettingsPage() {
  const viewer = await requireRole('admin');
  const branding = await loadBranding(viewer.tenant);

  return (
    <div className="flex max-w-[1040px] flex-col gap-6">
      <header className="border-border flex flex-col gap-1.5 border-b pb-[18px]">
        <h1 className="text-(length:--text-staff-page) leading-[1.2]">
          Branding
        </h1>
        <p className="text-muted-foreground max-w-[72ch] text-(length:--text-ui) leading-[1.6]">
          Pick a preset, then change up to four things. Text colours are worked
          out from what you choose rather than typed, so you cannot end up with
          white words on a white button. There is no custom stylesheet here on
          purpose: everything is a named setting, so nothing you save can break
          a page or run in a student&rsquo;s browser.
        </p>
      </header>

      <BrandingForm
        theme={branding.theme}
        copy={branding.written}
        logoUrl={branding.logoUrl}
        host={viewer.tenant.host}
        name={branding.name}
      />
    </div>
  );
}
