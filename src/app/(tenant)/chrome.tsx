import Link from 'next/link';
import { SignOutButton } from './sign-out-button';
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

/**
 * One nav link. Sized from the interface scale so the row stays on a single
 * baseline whatever the institute's radius or brand does.
 */
function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="text-(length:--text-ui) font-medium opacity-85 hover:opacity-100"
    >
      {children}
    </Link>
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
      <nav className="mx-auto flex max-w-[1080px] flex-wrap items-center gap-x-6 gap-y-2 px-8 py-4">
        <Link href="/" className="mr-3 flex items-center gap-2.5">
          <Wordmark branding={branding} />
        </Link>

        {/*
          Browsing and studying are two different questions, so they are two
          different links rather than one that changes meaning. Previously
          "Courses" pointed at the shelf once signed in, which left a student
          with no way back to the public catalogue from the nav at all.
        */}
        <NavLink href="/catalogue">Courses</NavLink>

        {/* /courses is the shelf, gated on a membership; a visitor or a
            session with no standing here has nothing to shelve. */}
        {viewer ? <NavLink href="/courses">My study</NavLink> : null}

        {/* Only shown to people who have somewhere to go. An instructor link on
            a student's screen is a 404 waiting to be clicked. */}
        {viewer && viewer.role !== 'student' ? (
          <NavLink href="/teach">Teach</NavLink>
        ) : null}

        {/* Every admin screen, not a sample of them. Domains and Signup were
            built and linked from nowhere, so the only way to reach them was to
            know the URL. A screen nobody can navigate to may as well not
            exist. */}
        {viewer?.role === 'admin' ? (
          <>
            <NavLink href="/settings/people">People</NavLink>
            <NavLink href="/settings/branding">Branding</NavLink>
            <NavLink href="/settings/domains">Domains</NavLink>
            <NavLink href="/settings/signup">Signup</NavLink>
          </>
        ) : null}

        <div className="ml-auto flex items-center gap-3.5">
          {viewer ? (
            <>
              {/* The address rather than a name: it is what tells somebody
                  which of their two institutes they are signed in to. */}
              <Link
                href="/account"
                className="text-muted-foreground text-(length:--text-label) hover:underline"
              >
                {viewer.email}
              </Link>
              <SignOutButton />
            </>
          ) : (
            <Link
              href="/sign-in"
              className="bg-primary text-primary-foreground rounded-(--radius) px-3.5 py-2 text-(length:--text-ui) font-medium"
            >
              Sign in
            </Link>
          )}
        </div>
      </nav>
    </header>
  );
}

export function SiteFooter({ branding }: { branding: Branding }) {
  return (
    <footer className="border-border text-muted-foreground mt-14 border-t">
      <div className="mx-auto flex max-w-[1080px] flex-wrap items-center gap-x-4 gap-y-1 px-8 py-6 text-(length:--text-label)">
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
