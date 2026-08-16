import { requireRole } from '@/lib/auth/guards';
import { loadBranding } from '@/lib/theme/branding';
import { BrandingForm } from './branding-form';

/**
 * What the institute looks like and what it says (PRD section 9, P0-12).
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
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-10">
      <div className="flex flex-col gap-1">
        <p className="text-muted-foreground text-sm tracking-wide uppercase">
          {viewer.tenant.name}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">Branding</h1>
        <p className="text-muted-foreground">
          Your colours, your logo, and the words on your front page. There is no
          custom stylesheet here on purpose: everything is a named setting, so
          nothing you save can break a page or run in a student&rsquo;s browser.
        </p>
      </div>

      <BrandingForm
        theme={branding.theme}
        copy={branding.written}
        logoUrl={branding.logoUrl}
      />
    </main>
  );
}
