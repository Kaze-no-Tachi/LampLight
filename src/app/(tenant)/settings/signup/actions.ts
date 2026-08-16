'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { getTenantDb } from '@/db/client';
import { auditLog, tenantSettings } from '@/db/schema';
import { requireRole } from '@/lib/auth/guards';
import { signupQuestionsSchema } from '@/lib/signup/questions';

/**
 * Signup settings for one institute, admin only.
 *
 * The tenant comes from the resolved Host header through requireRole, never
 * from the form. A server action is a public endpoint that happens to be
 * called from a page.
 */

export type SaveResult =
  { status: 'ok' } | { status: 'error'; message: string };

export async function saveSignupSettingsAction(
  formData: FormData,
): Promise<SaveResult> {
  const viewer = await requireRole('admin');

  const mode = String(formData.get('signupMode') ?? 'closed');
  if (mode !== 'open' && mode !== 'closed') {
    return { status: 'error', message: 'Unknown signup mode.' };
  }

  let questions;
  try {
    questions = signupQuestionsSchema.parse(
      JSON.parse(String(formData.get('questions') ?? '[]')),
    );
  } catch (error) {
    // The message names the offending field, because an admin editing a
    // question list needs to know which one, and none of this is secret.
    return {
      status: 'error',
      message: `Those questions are not valid: ${describe(error)}`,
    };
  }

  await getTenantDb(viewer.tenant.id).run(async (scope) => {
    await scope.tx
      .update(tenantSettings)
      .set({
        signupMode: mode,
        signupQuestionsJson: questions,
        updatedAt: new Date(),
      })
      .where(eq(tenantSettings.tenantId, scope.tenantId));

    // Opening signup is a decision worth being able to point at later, which
    // is the standing rule for anything that changes who can get in.
    await scope.tx.insert(auditLog).values({
      tenantId: scope.tenantId,
      actorUserId: viewer.userId,
      action: 'settings.signup_changed',
      targetType: 'tenant_settings',
      targetId: scope.tenantId,
      metadataJson: { signupMode: mode, questionCount: questions.length },
    });
  });

  revalidatePath('/settings/signup');
  revalidatePath('/sign-up');
  return { status: 'ok' };
}

function describe(error: unknown): string {
  if (error instanceof SyntaxError) return 'the list is not valid JSON';
  if (error && typeof error === 'object' && 'issues' in error) {
    const issues = (
      error as { issues: { path: (string | number)[]; message: string }[] }
    ).issues;
    return issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join('.') || 'list'}: ${issue.message}`)
      .join('; ');
  }
  return 'unknown problem';
}
