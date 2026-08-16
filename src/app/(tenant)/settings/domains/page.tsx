import { requireRole } from '@/lib/auth/guards';
import { customHostnamesConfigured } from '@/lib/cloudflare/custom-hostnames';
import { refreshAllDomains } from '@/lib/domains/service';
import { DomainList } from './domain-list';
import { AddDomainForm } from './add-domain-form';

/**
 * Custom domains for one institute (PRD requirement P0-4).
 *
 * requireRole('admin') needs a session and an admin membership in the tenant
 * this request arrived on, and denies with 404 like every other guard. An
 * instructor, a student, or somebody signed in at another institute all get
 * the same answer a stranger gets, which is that this path does not exist.
 *
 * Status is refreshed on view. DNS propagation is the thing being waited on
 * here, and the moment an admin opens this page is the moment they want to
 * know, so a page load is worth an API call. Active domains are skipped, so a
 * settled institute costs nothing.
 */
export const dynamic = 'force-dynamic';

export default async function DomainsPage() {
  const viewer = await requireRole('admin');
  const domains = await refreshAllDomains(viewer.tenant.id);

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 p-8">
      <div className="flex flex-col gap-1">
        <p className="text-muted-foreground text-sm tracking-wide uppercase">
          {viewer.tenant.name}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">Domains</h1>
        <p className="text-muted-foreground">
          Use your own web address. Add it here, create the two DNS records we
          show you, and it goes live once your provider has published them.
          Nothing changes for your existing site until you create the CNAME.
        </p>
      </div>

      {!customHostnamesConfigured() ? (
        <p className="rounded-lg border p-4 text-sm">
          Custom domains are not configured on this instance.
        </p>
      ) : (
        <>
          <AddDomainForm />
          <DomainList domains={domains} tenantHost={viewer.tenant.host} />
        </>
      )}
    </main>
  );
}
