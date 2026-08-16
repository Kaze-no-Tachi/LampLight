import { requireTenant } from '@/lib/tenancy/context';
import { SignInForm } from './sign-in-form';

/**
 * Sign in, on an institute's own domain.
 *
 * The session it mints is platform-wide identity and nothing more. Standing at
 * this institute still comes from a membership row, checked on every gated
 * page by requireViewer, so signing in here grants exactly nothing anywhere
 * else. The cookie is host-only, so it is not even transmitted to another
 * institute's domain.
 */
export const dynamic = 'force-dynamic';

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const tenant = await requireTenant();
  const { next } = await searchParams;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-8">
      <p className="text-muted-foreground text-sm tracking-wide uppercase">
        {tenant.name}
      </p>
      <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
      <SignInForm next={safeNext(next)} />
    </main>
  );
}

/**
 * Only same-origin paths are honoured as a return destination.
 *
 * An unchecked `next` is an open redirect, and on a platform where the whole
 * point is that institutes are separate hosts, it would be a particularly good
 * one: a link that signs somebody in at their own institute and bounces them
 * to a page somewhere else that looks just like it.
 */
function safeNext(candidate: string | undefined): string {
  if (!candidate) return '/account';
  // Must be a path, and must not be protocol-relative (//evil.example is a
  // different host despite starting with a slash).
  if (!candidate.startsWith('/') || candidate.startsWith('//')) {
    return '/account';
  }
  return candidate;
}
