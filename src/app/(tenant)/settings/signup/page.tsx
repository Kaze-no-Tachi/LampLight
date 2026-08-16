import { eq } from 'drizzle-orm';
import { getTenantDb } from '@/db/client';
import { tenantSettings } from '@/db/schema';
import { requireRole } from '@/lib/auth/guards';
import { parseQuestions } from '@/lib/signup/questions';
import { SignupSettingsForm } from './signup-settings-form';

/**
 * Who may join this institute, and what they are asked (PRD section 9).
 *
 * Admin only, denied with 404 like every other guard, so an instructor or
 * somebody signed in at another institute sees what a stranger sees.
 */
export const dynamic = 'force-dynamic';

export default async function SignupSettingsPage() {
  const viewer = await requireRole('admin');

  const row = await getTenantDb(viewer.tenant.id).run(async (scope) => {
    const rows = await scope.tx
      .select({
        signupMode: tenantSettings.signupMode,
        questions: tenantSettings.signupQuestionsJson,
      })
      .from(tenantSettings)
      .where(eq(tenantSettings.tenantId, scope.tenantId))
      .limit(1);
    return rows[0] ?? null;
  });

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 p-8">
      <div className="flex flex-col gap-1">
        <p className="text-muted-foreground text-sm tracking-wide uppercase">
          {viewer.tenant.name}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">Signup</h1>
        <p className="text-muted-foreground">
          Whether anyone can create their own account here, and what you ask
          them when they do. Answers are kept against this institute only: they
          are not shared with any other institute on Lamplight, even for a
          student who studies at both.
        </p>
      </div>

      <SignupSettingsForm
        mode={row?.signupMode === 'open' ? 'open' : 'closed'}
        questions={parseQuestions(row?.questions)}
      />
    </main>
  );
}
