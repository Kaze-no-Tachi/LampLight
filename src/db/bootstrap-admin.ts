import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { config as loadEnv } from 'dotenv';
import { platformAdmins, users } from './schema';
import { closeAdminDb, getAdminDb } from './admin';

/**
 * Creates the first platform operator on a fresh deployment.
 *
 * WHY THIS HAS TO EXIST
 *
 * The superadmin console is gated on a row in `platform_admins`, and a
 * production database has none. Nothing in the product creates one: signup is
 * scoped to an institute and produces an invitation rather than an account,
 * and provisioning an institute is itself a superadmin action. The seed does
 * create an operator, but it also invents two fictional institutes with
 * fictional students, so it must never be pointed at a real deployment.
 *
 * The result was a platform that came up correctly and locked out the person
 * who deployed it: the console answers 404, which is the same answer it gives
 * a stranger, because a gate that admits it exists is a gate that leaks. Found
 * on the first real deploy, with everything else already working.
 *
 * WHAT IT DOES
 *
 *   node_modules/.bin/tsx src/db/bootstrap-admin.ts <email> ["Full Name"]
 *
 * The account is created through the same Better Auth call the activation
 * route uses, so the password is hashed the way sign-in will verify it. Doing
 * it with an INSERT and a hash of our own is how you produce an account that
 * exists and cannot sign in.
 *
 * The address is marked verified directly afterwards. Sign-in requires a
 * verified address, and the usual proof is following a mailed link, which
 * belongs to an institute's hostname and to a flow that has no meaning at the
 * apex. Somebody holding the database credentials and a shell on the box has
 * already demonstrated more authority than an email round trip would.
 *
 * REFUSES TO BE A BACK DOOR
 *
 * It stops if any platform admin already exists. This runs once, at the
 * beginning, against a database nobody is using yet. On a live platform it is
 * a way to silently grant somebody the keys to every institute, so the second
 * run is the one worth refusing, and promotion afterwards is a deliberate
 * change somebody makes knowingly rather than a script they can rerun.
 */

loadEnv();

/** Better Auth is configured with this minimum; matching it fails earlier. */
const MIN_PASSWORD_LENGTH = 12;

function usage(message: string): never {
  console.error(
    `${message}\n\n` +
      'usage: tsx src/db/bootstrap-admin.ts <email> ["Full Name"]\n\n' +
      '  Set BOOTSTRAP_PASSWORD to choose the password. Without it one is\n' +
      '  generated and printed once, and never stored anywhere else.',
  );
  process.exit(1);
}

async function main(): Promise<void> {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email?.includes('@')) usage('An email address is required.');

  // After the check, not before: a name defaulting to the email has to inherit
  // the narrowed type, and Better Auth requires one.
  const name = process.argv[3]?.trim() || email;

  const password = process.env.BOOTSTRAP_PASSWORD ?? generatePassword();
  const generated = !process.env.BOOTSTRAP_PASSWORD;

  if (password.length < MIN_PASSWORD_LENGTH) {
    usage(
      `BOOTSTRAP_PASSWORD is ${password.length} characters. ` +
        `${MIN_PASSWORD_LENGTH} is the minimum.`,
    );
  }

  const db = getAdminDb();

  const existing = await db.select().from(platformAdmins).limit(1);
  if (existing.length > 0) {
    console.error(
      'This platform already has an operator, so nothing was changed.\n' +
        'Promote somebody else with a deliberate INSERT into platform_admins,\n' +
        'not by rerunning this.',
    );
    process.exit(1);
  }

  // Imported here rather than at the top: constructing Better Auth reads
  // BETTER_AUTH_SECRET and opens a pool, and neither should happen while the
  // arguments are still being rejected.
  const { getAuth } = await import('@/lib/auth');

  const [alreadyAUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  let userId: string;

  if (alreadyAUser) {
    // An address that already holds an account keeps its password. Resetting
    // it here would mean this script could take over any existing identity by
    // naming it, which is the same rule provisioning an institute follows.
    console.log(`${email} already has an account; leaving its password alone.`);
    userId = alreadyAUser.id;
  } else {
    const created = await getAuth().api.signUpEmail({
      body: { email, password, name },
      asResponse: false,
    });

    const id = created?.user?.id;
    if (!id) throw new Error('Better Auth did not return a user.');
    userId = id;
  }

  // Sign-in refuses an unverified address, and there is no institute here to
  // send the proof from.
  await db
    .update(users)
    .set({ emailVerified: true })
    .where(eq(users.id, userId));

  await db.insert(platformAdmins).values({ userId });

  console.log(`\nPlatform operator created: ${email}`);
  if (generated && !alreadyAUser) {
    console.log(`Password (shown once, not stored): ${password}`);
  }
  console.log(
    '\nSign in at the platform apex, then provision the first institute\n' +
      'from the superadmin console. See docs/runbook.md section 4a.',
  );
}

/**
 * A password nobody has to invent under pressure.
 *
 * Base64url rather than base64, so it survives being pasted into a URL, a
 * shell, or a form without anything needing to escape it.
 */
function generatePassword(): string {
  return randomBytes(24).toString('base64url');
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => closeAdminDb());
