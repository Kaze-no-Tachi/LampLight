import Link from 'next/link';
import type { Viewer } from '@/lib/auth/guards';
import type { Branding } from '@/lib/theme/branding';
import { themeCss } from '@/lib/theme/theme';

/**
 * The frame every institute page sits in: its colours, its mark, its words.
 *
 * Server components, all of them. The theme is a property of the request's
 * host, so it has to be decided before anything renders, and shipping it to
 * the client to apply would mean a flash of the default palette on every page
 * load.
 */

/**
 * The institute's palette, as a single :root block.
 *
 * A text child rather than dangerouslySetInnerHTML. That is safe here for a
 * specific reason rather than by luck: themeCss builds its output from a fixed
 * token list and values it re-serialised from parsed numbers, and checks the
 * result against a character set that excludes everything React would escape.
 * See src/lib/theme/theme.ts.
 *
 * The precedence prop makes React 19 hoist this into <head>, so it lands after
 * globals.css and its declarations win without needing !important.
 */
export function ThemeStyle({ branding }: { branding: Branding }) {
  return (
    <style href="lamplight-theme" precedence="high">
      {themeCss(branding.theme)}
    </style>
  );
}

/**
 * The mark: an uploaded logo where the institute has one, its name in type
 * where it does not.
 *
 * A plain img rather than next/image on purpose. next/image would route every
 * institute's logo through our optimizer, which means allowing arbitrary
 * remote hosts in next.config and turning the server into a fetcher of
 * whatever URL an admin types.
 */
function Wordmark({ branding }: { branding: Branding }) {
  if (branding.logoUrl) {
    return (
      // A tenant-supplied remote URL, for the reason in the comment above.
      // eslint-disable-next-line @next/next/no-img-element -- not proxied on purpose
      <img
        src={branding.logoUrl}
        alt={branding.name}
        className="h-8 w-auto max-w-[12rem] object-contain"
      />
    );
  }

  return (
    <span className="text-lg font-semibold tracking-tight">
      {branding.name}
    </span>
  );
}

export function SiteHeader({
  branding,
  viewer,
}: {
  branding: Branding;
  viewer: Viewer | null;
}) {
  return (
    <header className="border-border bg-card border-b">
      <nav className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-6 py-4">
        <Link href="/" className="mr-auto flex items-center gap-3">
          <Wordmark branding={branding} />
        </Link>

        <Link href="/courses" className="text-sm hover:underline">
          Courses
        </Link>

        {/* Only shown to people who have somewhere to go. An instructor link on
            a student's screen is a 404 waiting to be clicked. */}
        {viewer && viewer.role !== 'student' ? (
          <Link href="/teach" className="text-sm hover:underline">
            Teach
          </Link>
        ) : null}

        {viewer?.role === 'admin' ? (
          <Link href="/settings/branding" className="text-sm hover:underline">
            Settings
          </Link>
        ) : null}

        {viewer ? (
          <Link href="/account" className="text-sm hover:underline">
            Account
          </Link>
        ) : (
          <Link
            href="/sign-in"
            className="bg-primary text-primary-foreground rounded-(--radius) px-3 py-1.5 text-sm"
          >
            Sign in
          </Link>
        )}
      </nav>
    </header>
  );
}

export function SiteFooter({ branding }: { branding: Branding }) {
  return (
    <footer className="border-border text-muted-foreground mt-16 border-t">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-1 px-6 py-6 text-sm">
        <span>{branding.legalName ?? branding.copy.footer}</span>
        {branding.supportEmail ? (
          <a
            href={`mailto:${branding.supportEmail}`}
            className="hover:underline"
          >
            {branding.supportEmail}
          </a>
        ) : null}
        <span className="ml-auto">Powered by Lamplight</span>
      </div>
    </footer>
  );
}
