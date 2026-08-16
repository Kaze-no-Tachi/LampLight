import { requireViewer } from '@/lib/auth/guards';

/**
 * A gated page, and the smallest honest demonstration of the isolation model.
 *
 * requireViewer needs both halves: a session, and a membership in the tenant
 * resolved from the Host header. Someone signed in at one institute who visits
 * another institute's domain has the first and not the second, and gets the
 * ordinary 404, identical to the one an unknown visitor sees.
 */
export const dynamic = 'force-dynamic';

export default async function AccountPage() {
  const viewer = await requireViewer();

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-3 p-8">
      <p className="text-muted-foreground text-sm tracking-wide uppercase">
        {viewer.tenant.slug}
      </p>
      <h1 className="text-3xl font-semibold tracking-tight">{viewer.email}</h1>
      <p className="text-muted-foreground">
        Signed in with the role <strong>{viewer.role}</strong> at this
        institute.
      </p>
    </main>
  );
}
