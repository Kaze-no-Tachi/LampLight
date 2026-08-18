import { Button, Divider, Panel, Tag } from 'rsuite';
import { themeCss } from '@/lib/theme/theme';
import { requireApex } from '@/lib/tenancy/context';
import { RsuiteProvider } from '../../(tenant)/rsuite-provider';

/**
 * The platform apex home. Middleware rewrites "/" onto this route when the
 * request arrives on the apex, which leaves "/" available to tenants.
 *
 * requireApex is the actual guard. Without it this route would be reachable
 * directly at /platform-home from any institute's domain.
 *
 * A basic, real page rather than the placeholder it replaces, ahead of a
 * full visual reskin the rest of the app is about to get: not worth
 * polishing twice. The style block and rsuite wiring below are the same
 * mechanism a tenant page uses (ThemeStyle in (tenant)/chrome.tsx), just
 * inlined with the fixed "classic" preset rather than a per-institute
 * lookup, since there is no institute here and no other Lamplight brand
 * color declared anywhere yet.
 *
 * The header's Sign in is disabled and badged "Coming soon" rather than
 * linked anywhere: the only working sign-in at the apex today is the
 * platform-operator console, and a stranger clicking a plain "Sign in"
 * button expecting to reach their own institute would land there instead.
 */
export const dynamic = 'force-dynamic';

const FEATURES = [
  {
    title: 'Audio first',
    body: 'Lectures a student can listen to on the way to work, with the text alongside for when they want it.',
  },
  {
    title: 'Its own address',
    body: 'Every institute gets a site on its own domain, themed in its own colors, not a shared portal with someone else’s name on it.',
  },
  {
    title: 'Courses into programs',
    body: 'Bundle courses into a program a student enrols in once, rather than piecing together access one course at a time.',
  },
];

export default async function PlatformHome() {
  await requireApex();

  const theme = themeCss({
    preset: 'classic',
    brand: null,
    accent: null,
    background: null,
    radius: null,
  });

  return (
    <>
      <style href="lamplight-platform-theme" precedence="high">
        {theme}
      </style>
      <RsuiteProvider>
        <div className="flex min-h-screen flex-col">
          <header className="mx-auto flex w-full max-w-4xl items-center justify-between p-8">
            <span className="text-lg font-semibold tracking-tight">
              Lamplight
            </span>
            <div className="flex items-center gap-2">
              <Button appearance="ghost" disabled>
                Sign in
              </Button>
              <Tag color="orange" size="sm">
                Coming soon
              </Tag>
            </div>
          </header>

          <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-10 px-8 pb-16">
            <div className="flex flex-col gap-4 py-8">
              <h1 className="text-4xl font-semibold tracking-tight text-balance">
                Audio courses and degree programs for bible institutes.
              </h1>
              <p className="text-muted-foreground max-w-2xl text-lg">
                One deployment, and every institute gets its own branded site on
                its own domain, not a shared portal with someone else&rsquo;s
                name on it.
              </p>
            </div>

            <Divider />

            <div className="grid gap-6 sm:grid-cols-3">
              {FEATURES.map((feature) => (
                <Panel key={feature.title} header={feature.title} bordered>
                  <p className="text-muted-foreground text-sm">
                    {feature.body}
                  </p>
                </Panel>
              ))}
            </div>
          </main>

          <footer className="mx-auto w-full max-w-4xl p-8">
            <p className="text-muted-foreground text-sm">Lamplight</p>
          </footer>
        </div>
      </RsuiteProvider>
    </>
  );
}
