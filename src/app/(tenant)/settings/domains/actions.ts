'use server';

import { revalidatePath } from 'next/cache';
import { requireRole } from '@/lib/auth/guards';
import {
  attachDomain,
  removeDomain,
  setPrimaryDomain,
} from '@/lib/domains/service';

/**
 * Domain actions, admin only.
 *
 * Every one of these re-establishes the viewer through requireRole rather than
 * trusting anything the form sent. A server action is a public endpoint that
 * happens to be called from a form, and the tenant id comes from the resolved
 * Host header, never from the request body: accepting a tenant id from the
 * client would let anybody edit any institute's domains.
 */

export type ActionResult =
  { status: 'ok' } | { status: 'error'; message: string };

export async function addDomainAction(
  formData: FormData,
): Promise<ActionResult> {
  const viewer = await requireRole('admin');
  const hostname = String(formData.get('hostname') ?? '');

  const result = await attachDomain(viewer.tenant.id, hostname);
  revalidatePath('/settings/domains');

  return result.status === 'ok'
    ? { status: 'ok' }
    : { status: 'error', message: result.message };
}

export async function removeDomainAction(
  formData: FormData,
): Promise<ActionResult> {
  const viewer = await requireRole('admin');
  const id = String(formData.get('id') ?? '');
  if (!id) return { status: 'error', message: 'Nothing to remove.' };

  try {
    await removeDomain(viewer.tenant.id, id);
  } catch {
    return {
      status: 'error',
      message: 'Could not reach Cloudflare just now. Try again in a moment.',
    };
  }

  revalidatePath('/settings/domains');
  return { status: 'ok' };
}

export async function setPrimaryAction(
  formData: FormData,
): Promise<ActionResult> {
  const viewer = await requireRole('admin');
  const id = String(formData.get('id') ?? '');
  if (!id) return { status: 'error', message: 'Nothing to change.' };

  const ok = await setPrimaryDomain(viewer.tenant.id, id);
  revalidatePath('/settings/domains');

  return ok
    ? { status: 'ok' }
    : {
        status: 'error',
        message: 'Only a verified domain can be the primary one.',
      };
}
