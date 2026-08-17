'use server';

import { revalidatePath } from 'next/cache';
import { requireRole } from '@/lib/auth/guards';
import { issueInvitation, type InvitationRole } from '@/lib/auth/invitations';
import { grantEnrollment, revokeEnrollment } from '@/lib/entitlements/grants';
import { sendMail } from '@/lib/mail';
import { invitationEmail } from '@/lib/mail/messages';

/**
 * People and access, admin only.
 *
 * Every action re-establishes the viewer through requireRole and takes the
 * tenant from the resolved Host header, never from the form. A server action is
 * a public endpoint that happens to be called from a page, so a hidden field
 * naming a tenant would be a way to edit any institute's roster.
 */

export type ActionResult =
  { status: 'ok'; message?: string } | { status: 'error'; message: string };

export async function grantAction(formData: FormData): Promise<ActionResult> {
  const viewer = await requireRole('admin');

  const userId = String(formData.get('userId') ?? '');
  const source = String(formData.get('source') ?? '');
  const expires = String(formData.get('expiresAt') ?? '').trim();
  const reason = String(formData.get('reason') ?? '').trim();

  // One select, one value: "program:<id>" or "course:<id>". Parsed rather than
  // trusted, so a kind the enum does not have is refused here.
  const [kind, sourceId] = source.split(':');
  if ((kind !== 'program' && kind !== 'course') || !sourceId) {
    return { status: 'error', message: 'Choose a course or a program.' };
  }

  let expiresAt: Date | null = null;
  if (expires) {
    // A date input gives a plain date. End of that day in UTC is the reading
    // that matches what an admin means by "access until the 30th".
    const parsed = new Date(`${expires}T23:59:59Z`);
    if (Number.isNaN(parsed.getTime())) {
      return { status: 'error', message: 'That is not a date.' };
    }
    expiresAt = parsed;
  }

  const outcome = await grantEnrollment({
    tenantId: viewer.tenant.id,
    actorUserId: viewer.userId,
    userId,
    sourceKind: kind,
    sourceId,
    expiresAt,
    reason: reason || undefined,
  });

  revalidatePath('/settings/people');
  revalidatePath(`/settings/people/${userId}`);

  if (outcome.status === 'error') {
    return { status: 'error', message: outcome.message };
  }
  return {
    status: 'ok',
    message:
      outcome.status === 'already'
        ? 'They already had that. Nothing changed.'
        : 'Granted.',
  };
}

export async function revokeAction(formData: FormData): Promise<ActionResult> {
  const viewer = await requireRole('admin');

  const enrollmentId = String(formData.get('enrollmentId') ?? '');
  const userId = String(formData.get('userId') ?? '');
  if (!enrollmentId) {
    return { status: 'error', message: 'Nothing to revoke.' };
  }

  const outcome = await revokeEnrollment({
    tenantId: viewer.tenant.id,
    actorUserId: viewer.userId,
    enrollmentId,
    reason: String(formData.get('reason') ?? '').trim() || undefined,
  });

  revalidatePath('/settings/people');
  revalidatePath(`/settings/people/${userId}`);

  if (outcome.status === 'error') {
    return { status: 'error', message: outcome.message };
  }
  return {
    status: 'ok',
    // not_found and revoked answer the same way. An id that belongs to another
    // institute is indistinguishable from one that never existed.
    message: 'Access removed.',
  };
}

export type InviteResult = {
  status: 'ok';
  /** How many addresses were accepted, which is all of the valid ones. */
  invited: number;
  skipped: string[];
};

const MAX_INVITES = 100;

/**
 * Invites people by address, in bulk.
 *
 * Answers uniformly whatever the state of each address, exactly as self-serve
 * signup does. An admin here is trusted with their own institute's roster and
 * not with whether somebody holds an account at another institute on the
 * platform, so "already a member here" and "has an account elsewhere" and "new
 * to Lamplight" all count as invited. The invitation itself is what resolves
 * the difference, when the person follows it.
 *
 * Nothing is created for the invitee: an invitation is a row and an email, and
 * the account comes into being only when they set a password (see
 * src/lib/auth/invitations.ts).
 */
export async function inviteAction(
  formData: FormData,
): Promise<InviteResult | { status: 'error'; message: string }> {
  const viewer = await requireRole('admin');

  const roleInput = String(formData.get('role') ?? 'student');
  const role: InvitationRole = roleInput === 'admin' ? 'admin' : 'student';

  const raw = String(formData.get('emails') ?? '');
  const candidates = [
    ...new Set(
      raw
        .split(/[\s,;]+/)
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];

  if (candidates.length === 0) {
    return { status: 'error', message: 'No addresses.' };
  }
  if (candidates.length > MAX_INVITES) {
    return {
      status: 'error',
      message: `That is more than ${MAX_INVITES} addresses. Send it in batches.`,
    };
  }

  const skipped: string[] = [];
  let invited = 0;

  for (const email of candidates) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      skipped.push(email);
      continue;
    }

    const issued = await issueInvitation({
      tenantId: viewer.tenant.id,
      host: viewer.tenant.host,
      email,
      // An invited person has not told us their name yet. Activation asks.
      firstName: '',
      lastName: '',
      role,
    });

    // Null means one went out recently, which is not a failure and not the
    // admin's problem. Counted as invited, because from their point of view the
    // person has been invited.
    invited += 1;

    if (issued) {
      await sendMail(
        invitationEmail({
          to: email,
          instituteName: viewer.tenant.name,
          url: issued.url,
          expiresAt: issued.expiresAt,
          role,
        }),
      );
    }
  }

  revalidatePath('/settings/people');
  return { status: 'ok', invited, skipped };
}
