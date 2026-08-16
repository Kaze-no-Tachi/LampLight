import { requireTenant } from '@/lib/tenancy/context';
import { RequestResetForm } from './request-reset-form';
import { ResetPasswordForm } from './reset-password-form';

/**
 * Both halves of a password reset, decided by whether there is a token.
 *
 * No token means the person is asking for a link. A token means they followed
 * one and are choosing a new password. One route because it is one idea, and
 * because the link in the email should land somewhere that is obviously the
 * same place they started.
 *
 * Reachable without a session on purpose: not being able to sign in is the
 * situation. It sits under the tenant route group, so a host serving no
 * institute 404s before any of this renders.
 */
export const dynamic = 'force-dynamic';

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const tenant = await requireTenant();
  const { token } = await searchParams;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-8">
      <p className="text-muted-foreground text-sm tracking-wide uppercase">
        {tenant.name}
      </p>
      <h1 className="text-2xl font-semibold tracking-tight">
        {token ? 'Choose a new password' : 'Reset your password'}
      </h1>

      {token ? (
        <ResetPasswordForm token={token} />
      ) : (
        <>
          <p className="text-muted-foreground">
            Tell us your address and we will send a link.
          </p>
          <RequestResetForm />
        </>
      )}
    </main>
  );
}
