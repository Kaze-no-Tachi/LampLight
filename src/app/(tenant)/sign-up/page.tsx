import { eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { getTenantDb } from '@/db/client';
import { tenantSettings } from '@/db/schema';
import { parseQuestions } from '@/lib/signup/questions';
import { requireTenant } from '@/lib/tenancy/context';
import { getEnv } from '@/env';
import { SignUpForm } from './sign-up-form';

/**
 * The signup form, shown only where signup is actually open.
 *
 * Both gates apply, the platform switch and the institute's own setting, and a
 * closed institute gets the ordinary 404 rather than a page explaining that
 * signup is closed. An institute that has not opted in should be no more
 * distinguishable than a path that does not exist.
 *
 * Note the asymmetry with the endpoint: this page 404s when closed, while
 * POST /api/tenant/sign-up answers identically whatever the setting is. That
 * is deliberate. The page's existence is not a secret about any address, and
 * hiding a form nobody may use is the honest behaviour. The endpoint's
 * uniformity protects something else entirely: which addresses hold accounts.
 */
export const dynamic = 'force-dynamic';

export default async function SignUpPage() {
  const tenant = await requireTenant();

  if (!getEnv().SELF_SERVE_SIGNUP) notFound();

  const settings = await getTenantDb(tenant.id).run(async (scope) => {
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

  if (settings?.signupMode !== 'open') notFound();

  // Parsed here and passed down, so the form renders exactly what the endpoint
  // will validate against. Two independent readings of the same column are how
  // a form ends up asking for something the server then rejects.
  const questions = parseQuestions(settings.questions);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-8">
      <p className="text-muted-foreground text-sm tracking-wide uppercase">
        {tenant.name}
      </p>
      <h1 className="text-2xl font-semibold tracking-tight">
        Create your account
      </h1>
      <p className="text-muted-foreground">
        Tell us who you are and we will send a link to confirm your address.
      </p>
      <SignUpForm questions={questions} />
    </main>
  );
}
