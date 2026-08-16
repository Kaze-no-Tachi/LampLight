'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { getAdminDb } from '@/db/admin';
import {
  auditLog,
  signupInvitations,
  tenantBilling,
  tenantDomains,
  tenantSettings,
  tenants,
} from '@/db/schema';
import { activationPath, mintInvitationToken } from '@/lib/auth/invitations';
import { requirePlatformAdmin } from '@/lib/auth/guards';
import { sendMail } from '@/lib/mail';
import { adminInviteEmail } from '@/lib/mail/messages';
import { absoluteUrl, isValidSlug } from '@/lib/tenancy/host';
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

  // HOW THE FIRST ADMIN GETS IN
  //
  // They are invited, exactly as a student is. Provisioning creates no account,
  // sets no password, and writes no membership. It records an invitation with
  // role 'admin' and mails the link to the address, and the account comes into
  // being when that link is followed.
  //
  // Three things follow from that, all of them wanted:
  //
  //   The operator never sees a credential. A password an operator has seen is
  //   a secret two people know, it survives in whatever they pasted it into,
  //   and the admin can never be sure it went unused. Here the link goes from
  //   the mail server to the mailbox and the operator is not in the path.
  //
  //   Naming an address does not seize it. If the address already holds an
  //   account, nothing about it changes. The invitation still goes out, and
  //   its owner becomes an admin here only after signing in as themselves.
  //
  //   There is one activation path in the codebase, not two. Provisioning and
  //   self-serve signup end at the same route, so the rules about single use,
  //   expiry, and email verification are written once.
  //
  // The invitation is written with the cross-tenant client because the tenant
  // it belongs to is being created in this very transaction, so there is no
  // tenant scope to establish yet.
  const tenantId = crypto.randomUUID();
  const invite = mintInvitationToken();

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

    await tx.insert(signupInvitations).values({
      tenantId,
      email: adminEmail,
      role: 'admin',
      tokenHash: invite.tokenHash,
      expiresAt: invite.expiresAt,
    });

    await tx.insert(auditLog).values({
      tenantId,
      actorUserId: operator.userId,
      action: 'tenant.provisioned',
      targetType: 'tenant',
      targetId: tenantId,
      metadataJson: { slug, host, adminEmail },
    });
  });

  // After the commit, so a mail failure cannot leave an institute half created.
  // It can leave one created with no invitation delivered, which is the right
  // way round: provisioning again reissues the link, whereas a rolled back
  // institute with a delivered link would be a link to nowhere.
  await sendMail(
    adminInviteEmail({
      to: adminEmail,
      institute: name,
      url: absoluteUrl(host, activationPath(invite.token)),
      expiresAt: invite.expiresAt,
    }),
  );

  // Misses are cached, so the new host would 404 for a few seconds otherwise.
  invalidateTenantCache(host);
  revalidatePath('/superadmin');

  return { status: 'ok', slug, host, adminEmail };
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
