import { requireTenant } from '@/lib/tenancy/context';
import { SetPasswordForm } from './set-password-form';

/**
 * Where a setup or reset link lands.
 *
 * Reachable without a session on purpose: the whole point is that the person
 * cannot sign in yet. The token in the URL is the credential, and Better Auth
 * validates and consumes it, so this page holds no secret of its own.
 *
 * It sits under the tenant route group, so an unresolvable host still 404s
 * before any of this renders.
 */
export const dynamic = 'force-dynamic';

export default async function SetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const tenant = await requireTenant();
  const { token } = await searchParams;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-8">
      <p className="text-muted-foreground text-sm tracking-wide uppercase">
        {tenant.slug}
      </p>
      <h1 className="text-2xl font-semibold tracking-tight">
        Set your password
      </h1>
      {token ? (
        <SetPasswordForm token={token} />
      ) : (
        <p className="text-muted-foreground">
          This link is missing its token. Ask whoever invited you for a new one.
        </p>
      )}
    </main>
  );
}
