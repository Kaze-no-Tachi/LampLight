'use server';

import { eq, sql } from 'drizzle-orm';
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
      /** False when the operator chose to hold the invitation rather than send it. */
      invited: boolean;
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
  const adminName = String(formData.get('adminName') ?? '').trim();
  // Absent means held, not sent. A checkbox that is not ticked sends no field
  // at all, and defaulting to "send" on a missing field would make the quiet
  // case the loud one.
  const sendInvitation = formData.get('sendInvitation') !== null;

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
      firstName: firstWord(adminName),
      lastName: restOfName(adminName),
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
      metadataJson: { slug, host, adminEmail, sendInvitation },
    });
  });

  // After the commit, so a mail failure cannot leave an institute half created.
  // It can leave one created with no invitation delivered, which is the right
  // way round: provisioning again reissues the link, whereas a rolled back
  // institute with a delivered link would be a link to nowhere.
  //
  // HELD RATHER THAN SENT is a real case, not a convenience. An operator
  // setting an institute up ahead of a call does not want the admin's first
  // contact with the product to be a link they cannot yet be talked through.
  // The invitation exists either way, with the same expiry running from now,
  // and provisioning again reissues it: nothing here can leave an institute
  // without a way in.
  if (sendInvitation) {
    await sendMail(
      adminInviteEmail({
        to: adminEmail,
        institute: name,
        url: absoluteUrl(host, activationPath(invite.token)),
        expiresAt: invite.expiresAt,
      }),
    );
  }

  // Misses are cached, so the new host would 404 for a few seconds otherwise.
  invalidateTenantCache(host);
  revalidatePath('/superadmin');

  return { status: 'ok', slug, host, adminEmail, invited: sendInvitation };
}

/**
 * The name split into the two columns the invitation actually has.
 *
 * One field on the screen because "Their name" is one thing to the person
 * typing it, and a middle name landing in `lastName` is a better outcome than
 * two boxes nobody wants to fill in.
 */
function firstWord(value: string): string {
  return value.split(/\s+/)[0] ?? '';
}

function restOfName(value: string): string {
  return value.split(/\s+/).slice(1).join(' ');
}

export type TenantSummary = {
  id: string;
  slug: string;
  name: string;
  status: string;
  primaryHost: string | null;
  /** 'active' once the hostname resolves here, 'pending' while it does not. */
  primaryHostState: string | null;
  memberCount: number;
  /** The platform's cut, in basis points. Zero until somebody sets one. */
  applicationFeeBps: number;
};

/**
 * Every institute on the platform, with the four facts the console's table
 * shows: where it answers, how many people are in it, what the platform takes,
 * and whether it is switched on.
 *
 * The member count and the fee are here rather than fetched per row because
 * this is the one screen in the product that reads across institutes, and a
 * query per institute is how that screen gets slow at exactly the point the
 * platform starts working.
 *
 * getAdminDb, which bypasses RLS, is correct here and nowhere else: there is
 * no tenant to scope to, because the question is about all of them. The
 * ESLint allowlist is scoped to this directory for that reason.
 */
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
      verificationStatus: tenantDomains.verificationStatus,
      applicationFeeBps: tenantBilling.applicationFeeBps,
      memberCount: sql<number>`(
        select count(*) from memberships m where m.tenant_id = ${tenants.id}
      )`,
    })
    .from(tenants)
    .leftJoin(tenantDomains, eq(tenantDomains.tenantId, tenants.id))
    .leftJoin(tenantBilling, eq(tenantBilling.tenantId, tenants.id));

  const byId = new Map<string, TenantSummary>();
  for (const row of rows) {
    const entry = byId.get(row.id) ?? {
      id: row.id,
      slug: row.slug,
      name: row.name,
      status: row.status,
      primaryHost: null,
      primaryHostState: null,
      // count() comes back as a string from pg for bigint.
      memberCount: Number(row.memberCount),
      applicationFeeBps: row.applicationFeeBps ?? 0,
    };
    if (row.isPrimary && row.hostname) {
      entry.primaryHost = row.hostname;
      entry.primaryHostState = row.verificationStatus;
    }
    byId.set(row.id, entry);
  }

  return [...byId.values()].sort((a, b) => a.slug.localeCompare(b.slug));
}
