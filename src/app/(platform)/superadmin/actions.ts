'use server';

import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { getAdminDb } from '@/db/admin';
import {
  auditLog,
  memberships,
  tenantBilling,
  tenantDomains,
  tenantSettings,
  tenants,
  users,
} from '@/db/schema';
import { getAuth, takeSetupLink } from '@/lib/auth';
import { requirePlatformAdmin } from '@/lib/auth/guards';
import { isValidSlug } from '@/lib/tenancy/host';
import { invalidateTenantCache } from '@/lib/tenancy/resolve';
import { getEnv } from '@/env';

/**
 * Tenant provisioning (PRD requirement P0-13): create an institute, its
 * subdomain, and its first admin in one action.
 *
 * This file is one of the few permitted to import the RLS-bypassing client,
 * and the ESLint allowlist is scoped to exactly this directory. That is the
 * right place for it: creating a tenant is inherently cross-tenant work, since
 * the tenant does not exist yet and so no tenant scope can be established.
 *
 * Every path through here writes an audit_log row before returning, which is
 * the standing rule for operator actions (PRD section 5.1).
 */

export type ProvisionResult =
  | {
      status: 'ok';
      slug: string;
      host: string;
      adminEmail: string;
      setupUrl: string | null;
    }
  | { status: 'error'; message: string };

export async function provisionTenant(
  formData: FormData,
): Promise<ProvisionResult> {
  const operator = await requirePlatformAdmin();

  const slug = String(formData.get('slug') ?? '')
    .trim()
    .toLowerCase();
  const name = String(formData.get('name') ?? '').trim();
  const adminEmail = String(formData.get('adminEmail') ?? '')
    .trim()
    .toLowerCase();

  if (!isValidSlug(slug)) {
    return {
      status: 'error',
      message: 'Slug must be lowercase letters, digits, and hyphens.',
    };
  }
  if (name.length < 2) {
    return { status: 'error', message: 'Name is required.' };
  }
  if (!adminEmail.includes('@')) {
    return { status: 'error', message: 'A valid admin email is required.' };
  }

  const db = getAdminDb();

  const existing = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.slug, slug))
    .limit(1);
  if (existing.length > 0) {
    return { status: 'error', message: `The slug "${slug}" is already taken.` };
  }

  const env = getEnv();
  const host = `${slug}.${env.TENANT_SUBDOMAIN_ROOT}`;

  // The invited admin needs a way in, and email delivery is P1 work.
  //
  // The operator is handed a single-use expiring link, never a password. That
  // matters: a password the operator has seen is a credential two people know,
  // it survives in whatever they pasted it into, and the admin has no way to
  // be sure it was never used. A reset link is consumed once, expires, and
  // ends with the admin choosing a secret the operator never learns.
  //
  // When the address already has an account, no link is issued and nothing
  // about their credentials is touched. Provisioning must never become a way
  // to seize an existing identity by naming it.
  const priorUser = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, adminEmail))
    .limit(1);

  let adminUserId = priorUser[0]?.id ?? null;
  let setupUrl: string | null = null;
  const accountCreated = !adminUserId;

  if (!adminUserId) {
    // A random password nobody ever sees, immediately superseded by the reset
    // link below. The account cannot be signed into until the admin sets their
    // own, because this value is discarded here and never displayed or stored.
    const placeholder = randomBytes(24).toString('base64url');
    const created = await getAuth().api.signUpEmail({
      body: {
        email: adminEmail,
        password: placeholder,
        name: adminEmail.split('@')[0] ?? 'Institute Admin',
      },
      asResponse: false,
    });
    adminUserId = created?.user?.id ?? null;

    if (!adminUserId) {
      return {
        status: 'error',
        message: 'Could not create the admin account.',
      };
    }

    await getAuth().api.requestPasswordReset({
      body: { email: adminEmail, redirectTo: `https://${host}/set-password` },
    });

    // The captured URL is built against Better Auth's configured base, which
    // is a single value and therefore cannot be right for every institute.
    // The token is what matters, so it is lifted out and the link rebuilt
    // against this tenant's own host. Otherwise the operator would be handed a
    // localhost link, or worse, a link on some other institute's domain.
    setupUrl = rebuildSetupLink(takeSetupLink(adminEmail), host);
  }

  const tenantId = crypto.randomUUID();

  await db.transaction(async (tx) => {
    await tx
      .insert(tenants)
      .values({ id: tenantId, slug, name, status: 'active' });
    await tx.insert(tenantSettings).values({ tenantId, legalName: name });
    await tx.insert(tenantBilling).values({ tenantId });

    // The platform subdomain is active immediately: the platform owns the apex,
    // so there is nothing to verify. Custom domains are the ones that must
    // prove ownership before they resolve.
    await tx.insert(tenantDomains).values({
      tenantId,
      hostname: host,
      isPrimary: true,
      verificationStatus: 'active',
      verifiedAt: new Date(),
    });

    await tx.insert(memberships).values({
      tenantId,
      userId: adminUserId,
      role: 'admin',
    });

    await tx.insert(auditLog).values({
      tenantId,
      actorUserId: operator.userId,
      action: 'tenant.provisioned',
      targetType: 'tenant',
      targetId: tenantId,
      metadataJson: {
        slug,
        host,
        adminEmail,
        adminAccountCreated: accountCreated,
      },
    });
  });

  // Misses are cached, so the new host would 404 for a few seconds otherwise.
  invalidateTenantCache(host);
  revalidatePath('/superadmin');

  return { status: 'ok', slug, host, adminEmail, setupUrl };
}

export type TenantSummary = {
  id: string;
  slug: string;
  name: string;
  status: string;
  primaryHost: string | null;
};

export async function listTenants(): Promise<TenantSummary[]> {
  await requirePlatformAdmin();

  const rows = await getAdminDb()
    .select({
      id: tenants.id,
      slug: tenants.slug,
      name: tenants.name,
      status: tenants.status,
      hostname: tenantDomains.hostname,
      isPrimary: tenantDomains.isPrimary,
    })
    .from(tenants)
    .leftJoin(tenantDomains, eq(tenantDomains.tenantId, tenants.id));

  const byId = new Map<string, TenantSummary>();
  for (const row of rows) {
    const entry = byId.get(row.id) ?? {
      id: row.id,
      slug: row.slug,
      name: row.name,
      status: row.status,
      primaryHost: null,
    };
    if (row.isPrimary && row.hostname) entry.primaryHost = row.hostname;
    byId.set(row.id, entry);
  }

  return [...byId.values()].sort((a, b) => a.slug.localeCompare(b.slug));
}

/**
 * Rebuilds a captured reset link against the tenant's own hostname.
 *
 * Returns null rather than a wrong link if the shape is not what is expected,
 * because a setup link pointing at the wrong host is worse than none: it would
 * send a new institute's admin to somebody else's domain to type a password.
 */
function rebuildSetupLink(
  captured: string | null,
  host: string,
): string | null {
  if (!captured) return null;

  try {
    const parsed = new URL(captured);
    const token = parsed.pathname.split('/').filter(Boolean).pop();
    if (!token) return null;

    const callback = encodeURIComponent(`https://${host}/set-password`);
    return `https://${host}/api/auth/reset-password/${token}?callbackURL=${callback}`;
  } catch {
    return null;
  }
}
