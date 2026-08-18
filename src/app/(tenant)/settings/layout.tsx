import { requireViewer } from '@/lib/auth/guards';
import { loadBranding } from '@/lib/theme/branding';
import { StaffShell } from '../staff-shell';

/**
 * Every screen under /settings wears the staff sidebar.
 *
 * A layout rather than each page rendering the shell itself, so a screen added
 * here cannot forget its navigation. The tenant layout above suppresses its own
 * header for these paths (see src/lib/staff-paths.ts), which is what stops the
 * two chromes appearing at once.
 *
 * requireViewer here as well as in each page is deliberate: a layout and its
 * page are separate requests to the server, and a layout that assumed the page
 * had already checked would render this institute's sidebar to whoever asked.
 */
export default async function SettingsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const viewer = await requireViewer();
  const branding = await loadBranding(viewer.tenant);

  return (
    <StaffShell branding={branding} viewer={viewer}>
      {children}
    </StaffShell>
  );
}
