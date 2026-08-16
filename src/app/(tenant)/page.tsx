import { requireTenant } from '@/lib/tenancy/context';

export default async function TenantHome() {
  const tenant = await requireTenant();

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 p-8">
      <p className="text-muted-foreground text-sm tracking-wide uppercase">
        {tenant.host}
      </p>
      <h1 className="text-3xl font-semibold tracking-tight">{tenant.slug}</h1>
      <p className="text-muted-foreground">
        Tenant resolved from the Host header. The catalog, auth, and the player
        arrive in later phases.
      </p>
    </main>
  );
}
