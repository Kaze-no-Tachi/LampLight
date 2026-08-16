import { requireApex } from '@/lib/tenancy/context';

// Host-dependent, so never prerendered. See the note in (tenant)/layout.tsx.
export const dynamic = 'force-dynamic';

/**
 * Superadmin console skeleton (PRD milestone 2).
 *
 * Guarded on the apex only, so an institute's domain asking for /superadmin
 * gets the ordinary 404 and learns nothing about the console existing.
 *
 * The identity check is deliberately still missing: gating on platform_admins
 * needs sessions, which arrive with Better Auth in the next step of this phase.
 * Until then this route shows nothing an operator could act on, and the tenant
 * provisioning action (P0-13) is not wired up.
 */
export default async function SuperadminConsole() {
  await requireApex();

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 p-8">
      <h1 className="text-3xl font-semibold tracking-tight">Superadmin</h1>
      <p className="text-muted-foreground">
        Console skeleton. Operator authentication, tenant provisioning, and the
        domain verification view are not built yet.
      </p>
    </main>
  );
}
