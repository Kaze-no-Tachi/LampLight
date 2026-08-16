import { findAccountByEmail } from '@/db/client';
import { findPendingInvitation } from '@/lib/auth/invitations';
import { requireTenant } from '@/lib/tenancy/context';
import { ActivateForm } from './activate-form';

/**
 * Where an invitation link lands.
 *
 * Reachable without a session on purpose: not being able to sign in yet is the
 * whole situation. The token in the URL is the credential, and the server
 * validates it, so this page holds no secret of its own.
 *
 * It sits under the tenant route group, so a host that serves no institute
 * 404s before any of this renders, and a token minted for one institute shows
 * nothing on another's domain because the lookup is tenant scoped.
 */
export const dynamic = 'force-dynamic';

export default async function ActivatePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const tenant = await requireTenant();
  const { token } = await searchParams;
  const activationToken = token ?? '';

  const invitation = activationToken
    ? await findPendingInvitation(tenant.id, activationToken)
    : null;

  // Whether to ask for a password is decided here rather than in the browser,
  // because the browser cannot know and guessing wrong means either asking an
  // established account to invent a new password or asking a brand new one for
  // a password it does not have.
  const account = invitation
    ? await findAccountByEmail(invitation.email)
    : null;
  const needsSignIn = account !== null && account.emailVerified;

  if (!invitation) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-8">
        <p className="text-muted-foreground text-sm tracking-wide uppercase">
          {tenant.name}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">
          This link is not usable
        </h1>
        <p className="text-muted-foreground">
          It may have been used already, or it may have expired. Signing up
          again sends a new one.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-8">
      <p className="text-muted-foreground text-sm tracking-wide uppercase">
        {tenant.name}
      </p>
      <h1 className="text-2xl font-semibold tracking-tight">
        {needsSignIn
          ? 'Sign in to join'
          : `Welcome${invitation.firstName ? `, ${invitation.firstName}` : ''}`}
      </h1>
      <p className="text-muted-foreground">
        {needsSignIn
          ? `This address already has an account. Sign in with the password you already use, and you will be added to ${tenant.name}.`
          : `Choose a password and your ${tenant.name} account is ready.`}
      </p>
      <ActivateForm
        token={activationToken}
        needsPassword={account === null}
        needsSignIn={needsSignIn}
      />
    </main>
  );
}
