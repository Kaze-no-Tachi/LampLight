import { headers } from 'next/headers';
import Link from 'next/link';
import type { Viewer } from '@/lib/auth/guards';
import type { Branding } from '@/lib/theme/branding';
import { SignOutButton } from './sign-out-button';

/**
 * The frame every staff screen sits in.
 *
 * WHY STAFF GET A SIDEBAR AND STUDENTS DO NOT
 *
 * These are two different jobs. A student arrives to hear one lesson and
 * leaves; the horizontal header suits that, because navigation is the smallest
 * part of the screen. Staff work across a set of screens in one sitting, moving
 * between a course, its lessons and the roster, and a persistent list of where
 * they can go is worth the width it costs. It also puts the institute's name
 * and the signed-in person permanently on screen, which matters on the shared
 * office machine this product is usually used from.
 *
 * The nav is built from the viewer's role rather than rendered and hidden with
 * CSS: an instructor has no People screen to reach, and a link to a 404 is
 * worse than no link.
 */

/** One sidebar destination. */
function ShellLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`rounded-(--radius) px-3 py-2 text-(length:--text-ui) transition-colors ${
        active
          ? 'bg-secondary text-secondary-foreground font-medium'
          : 'hover:bg-muted font-medium opacity-80 hover:opacity-100'
      }`}
    >
      {children}
    </Link>
  );
}

/**
 * The institute's mark, in the sidebar rather than the header.
 *
 * A plain img rather than next/image for the same reason as in chrome.tsx:
 * next/image would route every institute's logo through our optimizer, which
 * means allowing arbitrary remote hosts and turning the server into a fetcher
 * of whatever URL an admin types.
 */
function ShellMark({ branding }: { branding: Branding }) {
  if (branding.logoUrl) {
    return (
      // A tenant-supplied remote URL, for the reason in the comment above.
      // eslint-disable-next-line @next/next/no-img-element -- not proxied on purpose
      <img
        src={branding.logoUrl}
        alt={branding.name}
        className="h-7 w-auto max-w-[9rem] object-contain"
      />
    );
  }

  return (
    <span className="text-(length:--text-ui) font-semibold tracking-tight">
      {branding.name}
    </span>
  );
}

/**
 * Which entry is current, worked out here rather than passed in by every page.
 *
 * A `section` prop would be one more thing to get wrong on each new screen, and
 * getting it wrong is invisible: the page renders, just with the wrong item
 * highlighted. The path already knows.
 */
function activeSection(path: string): string {
  const clean = path.split(/[?#]/)[0] ?? '';
  if (clean.startsWith('/settings/people')) return 'people';
  if (clean.startsWith('/settings/branding')) return 'branding';
  if (clean.startsWith('/settings/domains')) return 'domains';
  if (clean.startsWith('/settings/signup')) return 'signup';
  if (clean.startsWith('/teach')) return 'teaching';
  return '';
}

export async function StaffShell({
  branding,
  viewer,
  children,
}: {
  branding: Branding;
  viewer: Viewer;
  children: React.ReactNode;
}) {
  const isAdmin = viewer.role === 'admin';
  const section = activeSection(
    (await headers()).get('x-lamplight-path') ?? '',
  );

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <aside className="border-border bg-card flex shrink-0 flex-col gap-6 border-b px-6 py-6 lg:w-[236px] lg:border-r lg:border-b-0">
        <div className="flex flex-col gap-1">
          <Link href="/" className="w-fit">
            <ShellMark branding={branding} />
          </Link>
          {/* The role, not the person: it is what explains why this sidebar
              has three entries rather than five. */}
          <span className="text-muted-foreground text-(length:--text-meta)">
            {isAdmin ? 'Institute admin' : 'Instructor'}
          </span>
        </div>

        <nav className="flex flex-col gap-0.5">
          <ShellLink href="/teach" active={section === 'teaching'}>
            Teaching
          </ShellLink>

          {isAdmin ? (
            <>
              <ShellLink href="/settings/people" active={section === 'people'}>
                People
              </ShellLink>
              <ShellLink
                href="/settings/branding"
                active={section === 'branding'}
              >
                Branding
              </ShellLink>
              <ShellLink
                href="/settings/domains"
                active={section === 'domains'}
              >
                Domains
              </ShellLink>
              <ShellLink href="/settings/signup" active={section === 'signup'}>
                Signup
              </ShellLink>
            </>
          ) : null}
        </nav>

        {/* Pinned to the bottom on a tall screen, inline on a short one. The
            way out of a shared account should not need scrolling to find. */}
        <div className="border-border flex flex-col gap-1 lg:mt-auto lg:border-t lg:pt-4">
          <Link
            href="/account"
            className="truncate text-(length:--text-label) underline-offset-4 hover:underline"
          >
            {viewer.email}
          </Link>
          <div className="flex items-center gap-3">
            <Link
              href="/catalogue"
              className="text-muted-foreground text-(length:--text-meta) underline-offset-4 hover:underline"
            >
              View the catalogue
            </Link>
            <SignOutButton className="text-muted-foreground cursor-pointer text-(length:--text-meta) underline-offset-4 hover:underline disabled:opacity-60" />
          </div>
        </div>
      </aside>

      {/* 40px gutters here rather than the student surfaces' 32px: this column
          already sits beside the sidebar's own edge. */}
      <main className="min-w-0 flex-1 px-10 pt-12 pb-24">{children}</main>
    </div>
  );
}
