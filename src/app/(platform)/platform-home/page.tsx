import { requireApex } from '@/lib/tenancy/context';

// Host-dependent, so never prerendered. See the note in (tenant)/layout.tsx.
export const dynamic = 'force-dynamic';

/**
 * The platform apex home. Middleware rewrites "/" onto this route when the
 * request arrives on the apex, which leaves "/" available to tenants.
 *
 * requireApex is the actual guard. Without it this route would be reachable
 * directly at /platform-home from any institute's domain.
 */
export default async function PlatformHome() {
  await requireApex();

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 p-8">
      <h1 className="text-3xl font-semibold tracking-tight">Lamplight</h1>
      <p className="text-muted-foreground">
        Audio courses and degree programs for bible institutes, each on its own
        domain. Marketing copy lands in a later phase.
      </p>
    </main>
  );
}
