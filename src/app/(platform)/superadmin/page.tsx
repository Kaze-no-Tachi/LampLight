import { requirePlatformAdmin } from '@/lib/auth/guards';
import { requireApex } from '@/lib/tenancy/context';
import { listTenants } from './actions';
import { InstituteList } from './institute-list';
import { ProvisionForm } from './provision-form';

/**
 * Superadmin console (mockup 12, PRD milestone 2, requirement P0-13).
 *
 * Two independent gates, and both are necessary. requireApex keeps the console
 * off institute domains, so a tenant admin cannot even discover it exists.
 * requirePlatformAdmin keeps it away from everyone who is not an operator,
 * including institute admins, who hold the highest role inside their own
 * institute and none at all here.
 *
 * The page says "Platform, not a tenant" at the top, which the design asks for
 * and which is worth the line. This is the only screen in the product that
 * reads across institutes, it looks like an admin screen, and an operator who
 * forgets which one they are on is an operator about to act in the wrong place.
 */
export const dynamic = 'force-dynamic';

export default async function SuperadminConsole() {
  await requireApex();
  const operator = await requirePlatformAdmin();
  const tenants = await listTenants();

  return (
    <main className="mx-auto flex min-h-screen max-w-[1040px] flex-col gap-6 px-10 pt-12 pb-24">
      <header className="border-border flex flex-col gap-1.5 border-b pb-[18px]">
        <span className="text-muted-foreground text-[0.6875rem] font-medium tracking-[0.16em] uppercase">
          Platform, not a tenant
        </span>
        <h1 className="text-(length:--text-staff-page) leading-[1.2]">
          Institutes
        </h1>
        <p className="text-muted-foreground max-w-[72ch] text-(length:--text-ui) leading-[1.6]">
          Provisioning and domains. This console is the only place that reads
          across institutes, and it says so on the page so nobody mistakes it
          for an admin screen. Signed in as {operator.email}.
        </p>
      </header>

      <InstituteList tenants={tenants} />

      <ProvisionForm />
    </main>
  );
}
