import { requirePlatformAdmin } from '@/lib/auth/guards';
import { requireApex } from '@/lib/tenancy/context';
import { listTenants } from './actions';
import { ProvisionForm } from './provision-form';

/**
 * Superadmin console (PRD milestone 2, requirement P0-13).
 *
 * Two independent gates, and both are necessary. requireApex keeps the console
 * off institute domains, so a tenant admin cannot even discover it exists.
 * requirePlatformAdmin keeps it away from everyone who is not an operator,
 * including institute admins, who hold the highest role inside their own
 * institute and none at all here.
 */
export const dynamic = 'force-dynamic';

export default async function SuperadminConsole() {
  await requireApex();
  const operator = await requirePlatformAdmin();
  const tenants = await listTenants();

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 p-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold tracking-tight">Superadmin</h1>
        <p className="text-muted-foreground text-sm">
          Signed in as {operator.email}
        </p>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-medium">Institutes</h2>
        {tenants.length === 0 ? (
          <p className="text-muted-foreground">None provisioned yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {tenants.map((tenant) => (
              <li
                key={tenant.id}
                className="flex flex-col gap-1 rounded-lg border p-3"
              >
                <span className="font-medium">{tenant.name}</span>
                <span className="text-muted-foreground text-sm">
                  {tenant.primaryHost ?? 'no primary domain'} ({tenant.status})
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-medium">Provision an institute</h2>
        <p className="text-muted-foreground text-sm">
          Creates the tenant, its subdomain, and its first admin in one action.
        </p>
        <ProvisionForm />
      </section>
    </main>
  );
}
