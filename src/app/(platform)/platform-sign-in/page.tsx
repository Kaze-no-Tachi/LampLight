import { requireApex } from '@/lib/tenancy/context';
import { SignInForm } from '../../(tenant)/sign-in/sign-in-form';

/**
 * Sign in as a platform operator, on the apex.
 *
 * WHY THIS EXISTS SEPARATELY FROM THE INSTITUTE SIGN-IN
 *
 * The institute sign-in calls requireTenant, so on the apex it is a 404. That
 * left the platform with no front door at all: an operator could be created in
 * the database and had nowhere to type their password, while the superadmin
 * console answered 404 the way it answers a stranger. Found by deploying and
 * then asking the obvious question.
 *
 * Two route groups cannot both own `/sign-in`, which is the same constraint
 * that put the apex home page at `/platform-home`, so the middleware rewrites
 * `/sign-in` here when the request arrives on the apex. The visitor's URL stays
 * `/sign-in`, which is where anybody would look.
 *
 * requireApex rather than trusting the rewrite: a guard beside the page cannot
 * drift away from it, and middleware cannot reach the database.
 *
 * Signing in here grants nothing by itself. The console checks
 * requirePlatformAdmin separately, so an institute admin who finds this page
 * gets a session and then the same 404 as everybody else.
 */

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Sign in' };

export default async function PlatformSignInPage() {
  await requireApex();

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-8">
      <p className="text-muted-foreground text-sm tracking-wide uppercase">
        Lamplight
      </p>
      <h1 className="text-2xl font-semibold tracking-tight">
        Operator sign in
      </h1>
      <p className="text-muted-foreground text-sm">
        For platform operators. If you are looking for your institute, sign in
        on its own address rather than here.
      </p>
      {/*
        Straight to the console, since it is the only thing an operator has at
        the apex, and reset is null because password reset is an institute's
        flow and there is no institute here.
      */}
      <SignInForm next="/superadmin" resetHref={null} />
    </main>
  );
}
