'use client';

import { CustomProvider } from 'rsuite';

/**
 * rsuite's own context: locale, RTL, and the container its overlaid
 * components (Modal, Toaster) portal into. No `theme` prop, deliberately:
 * rsuite's light/dark/high-contrast modes are a separate palette selection
 * from this app's own per-institute theme, and picking one here would fight
 * the `--rs-*` overrides `ThemeStyle` already emits per tenant (see
 * `resolveRsuiteTokens` in `src/lib/theme/theme.ts`).
 */
export function RsuiteProvider({ children }: { children: React.ReactNode }) {
  return <CustomProvider>{children}</CustomProvider>;
}
