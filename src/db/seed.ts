import { pathToFileURL } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { closeAdminDb, getAdminDb } from './admin';
import { resetData } from './reset';
import { uploadSeedMedia, type SeedObject } from './seed-media';
import {
  courseBySlug,
  PLATFORM_OPERATOR,
  programBySlug,
  SEED_TENANTS,
  SHARED_STUDENT,
  seedUuid,
  userByKey,
  type SeedTenant,
  type SeedUser,
} from './seed-data';
import { getAuth } from '@/lib/auth';
import {
  accounts,
  auditLog,
  courseInstructors,
  courseResources,
  courses,
  enrollments,
  lessonResources,
  lessons,
  memberships,
  modules,
  orders,
  platformAdmins,
  productKind,
  products,
  programCourses,
  programs,
  progress,
  tenantBilling,
  tenantDomains,
  tenantSettings,
  tenants,
  users,
} from './schema';

loadEnv();

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

/**
 * Collects every distinct user across the fixture. The shared student appears
 * in both tenants' user sets and must be inserted once, since users are global
 * (PRD section 5.4).
 */
function collectUsers(tenantsToSeed: SeedTenant[]): SeedUser[] {
  const byId = new Map<string, SeedUser>();
  for (const tenant of tenantsToSeed) {
    for (const user of Object.values(tenant.users)) {
      byId.set(user.id, user);
    }
  }
  byId.set(PLATFORM_OPERATOR.id, PLATFORM_OPERATOR);
  return [...byId.values()];
}

/**
 * Collected while seeding and uploaded at the end, so the recordings behind the
 * fixture exist rather than being rows pointing at nothing.
 */
const seedObjects: SeedObject[] = [];

export async function seedDatabase(): Promise<void> {
  const db = getAdminDb();

  seedObjects.length = 0;
  await resetData();

  // Global identities first: memberships and every tenant-scoped user
  // reference depends on them.
  await db.insert(tenants).values(
    SEED_TENANTS.map((tenant) => ({
      id: tenant.id,
      slug: tenant.slug,
      name: tenant.name,
      status: 'active' as const,
    })),
  );

  await db.insert(users).values(
    collectUsers(SEED_TENANTS).map((user) => {
      const [firstName = '', ...rest] = user.name.split(' ');
      return {
        id: user.id,
        email: user.email,
        name: user.name,
        firstName,
        lastName: rest.join(' '),
        // Seeded people stand in for accounts that were activated the normal
        // way, which means their address was proven. Leaving this false would
        // lock every fixture account out of sign-in for a reason that has
        // nothing to do with what any test is checking.
        emailVerified: true,
      };
    }),
  );

  await db.insert(platformAdmins).values({ userId: PLATFORM_OPERATOR.id });

  await seedCredentials(collectUsers(SEED_TENANTS));

  for (const tenant of SEED_TENANTS) {
    await seedTenant(tenant);
  }

  // Last, and allowed to fail without failing the seed. A developer with no
  // bucket running still gets a complete database, which is what every test
  // needs; the audio is only needed by somebody actually listening.
  try {
    console.log(await uploadSeedMedia(seedObjects));
  } catch (error) {
    console.warn(`seed audio upload failed: ${String(error)}`);
  }
}

/**
 * The password every fixture account has.
 *
 * Well known and printed at the end of a seed run, because it protects nothing:
 * it exists so that somebody who has just started the stack can sign in as an
 * admin, an instructor, and a student and see what each of them sees. The seed
 * refuses to run with NODE_ENV=production, which is what keeps it out of
 * anywhere it would matter.
 */
export const SEED_PASSWORD = 'lamplight-demo-password';

/**
 * Gives every fixture user a password, through Better Auth's own hasher.
 *
 * Hashing here rather than writing a precomputed digest means the fixture
 * stays correct if the hashing configuration ever changes, and it means these
 * accounts are indistinguishable from ones created by activation. Before this,
 * seeded people existed but could not sign in, so clicking around the seeded
 * site meant first inventing an account that the fixture knew nothing about.
 */
async function seedCredentials(people: SeedUser[]): Promise<void> {
  const db = getAdminDb();
  const context = await getAuth().$context;
  const password = await context.password.hash(SEED_PASSWORD);

  await db.insert(accounts).values(
    people.map((person) => ({
      userId: person.id,
      // Better Auth's email/password provider looks itself up under this id,
      // and stores the user id as the account id.
      providerId: 'credential',
      accountId: person.id,
      password,
    })),
  );
}

async function seedTenant(tenant: SeedTenant): Promise<void> {
  const db = getAdminDb();
  const tenantId = tenant.id;

  await db.insert(tenantSettings).values({
    tenantId,
    // Null rather than a plausible CDN address. There is no uploaded object
    // behind a fixture, so a URL here renders a broken image on every page of
    // the seeded site, and the wordmark fallback is the path most institutes
    // are on before they upload anything anyway.
    logoUrl: null,
    themeJson: tenant.theme,
    copyJson: {
      tagline: 'Study at your own pace, from anywhere.',
      hero: `Theological training from ${tenant.name}.`,
      about:
        `${tenant.name} trains men and women for faithful ministry. ` +
        'Courses are audio lectures with written notes, and every course ' +
        'opens with a lesson you can hear before you enrol.',
      footer: `${tenant.name}, ${tenant.slug}.lamplight.school`,
    },
    supportEmail: `support@${tenant.slug}.test`,
    legalName: tenant.name,
    signupMode: tenant.signupMode,
    // Only the open institute asks anything, so the fixture covers a form with
    // questions and a form without, which are different code paths on both the
    // page and the endpoint.
    signupQuestionsJson:
      tenant.signupMode === 'open'
        ? [
            {
              id: 'congregation',
              label: 'Home congregation',
              help: 'Where you worship, so we can put you in touch with a local mentor.',
              type: 'text',
              required: true,
            },
            {
              id: 'track',
              label: 'Which track interests you?',
              type: 'select',
              required: false,
              options: ['Pastoral', 'Missions', 'Lay leadership'],
            },
          ]
        : [],
  });

  await db.insert(tenantBilling).values({
    tenantId,
    stripeAccountId: `acct_seed_${tenant.slug}`,
    chargesEnabled: true,
    payoutsEnabled: true,
    applicationFeeBps: tenant.applicationFeeBps,
    onboardedAt: daysFromNow(-90),
  });

  await db.insert(tenantDomains).values(
    tenant.domains.map((domain) => ({
      id: domain.id,
      tenantId,
      hostname: domain.hostname,
      isPrimary: domain.isPrimary,
      verificationStatus: domain.verificationStatus,
      cfHostnameId:
        domain.verificationStatus === 'active'
          ? `cf_${seedUuid(domain.hostname).slice(0, 12)}`
          : null,
      verifiedAt:
        domain.verificationStatus === 'active' ? daysFromNow(-60) : null,
    })),
  );

  await db.insert(memberships).values(
    Object.entries(tenant.users).map(([key, user]) => ({
      id: seedUuid(`${tenant.slug}/membership/${key}`),
      tenantId,
      userId: user.id,
      role: user.role,
      // Answers to whatever this institute asked, on the membership rather
      // than on the user. The shared student answers both institutes and the
      // two answers differ, which is the fixture that shows the column is
      // doing its job: one person, two institutes, two separate records.
      profileJson:
        tenant.signupMode === 'open' && user.role === 'student'
          ? {
              congregation: `${tenant.name} Chapel`,
              track: key === 'shared' ? 'Missions' : 'Pastoral',
            }
          : {},
    })),
  );

  // Products carry price and Stripe state for both programs and courses.
  await db.insert(products).values([
    ...tenant.programs.map((program) => ({
      id: program.productId,
      tenantId,
      kind: 'program' as (typeof productKind.enumValues)[number],
      stripePriceId: `price_seed_${tenant.slug}_${program.slug}`,
      priceCents: program.priceCents,
      currency: 'usd',
      isPublished: true,
    })),
    ...tenant.courses.map((course) => ({
      id: course.productId,
      tenantId,
      kind: 'course' as (typeof productKind.enumValues)[number],
      stripePriceId: `price_seed_${tenant.slug}_${course.slug}`,
      priceCents: course.priceCents,
      currency: 'usd',
      isPublished: course.isPublished,
    })),
  ]);

  await db.insert(programs).values(
    tenant.programs.map((program) => ({
      id: program.id,
      tenantId,
      productId: program.productId,
      title: program.title,
      slug: program.slug,
      descriptionMd: `## ${program.title}\n\nA structured course of study.`,
    })),
  );

  await db.insert(courses).values(
    tenant.courses.map((course) => ({
      id: course.id,
      tenantId,
      productId: course.productId,
      title: course.title,
      slug: course.slug,
      descriptionMd: `## ${course.title}\n\nAudio lectures with notes.`,
      isStandalonePurchasable: course.isStandalonePurchasable,
    })),
  );

  // A syllabus per course, marked public, since it is what somebody reads
  // while deciding whether to enrol.
  await db.insert(courseResources).values(
    tenant.courses.map((course) => ({
      id: course.syllabusId,
      tenantId,
      courseId: course.id,
      kind: 'link' as const,
      title: `${course.title} syllabus`,
      url: `https://${tenant.slug}.test/syllabus/${course.slug}.pdf`,
      isPublic: true,
      sortOrder: 0,
    })),
  );

  await db.insert(programCourses).values(
    tenant.programs.flatMap((program) =>
      program.courseSlugs.map((slug, index) => ({
        tenantId,
        programId: program.id,
        courseId: courseBySlug(tenant, slug).id,
        sortOrder: index,
      })),
    ),
  );

  await db.insert(courseInstructors).values(
    tenant.instructorCourseSlugs.map((slug) => ({
      tenantId,
      courseId: courseBySlug(tenant, slug).id,
      userId: userByKey(tenant, 'instructor').id,
    })),
  );

  await db.insert(modules).values(
    tenant.courses.flatMap((course) =>
      course.modules.map((courseModule) => ({
        id: courseModule.id,
        tenantId,
        courseId: course.id,
        title: courseModule.title,
        sortOrder: courseModule.sortOrder,
      })),
    ),
  );

  const allLessons = tenant.courses.flatMap((course) =>
    course.modules.flatMap((courseModule) =>
      courseModule.lessons.map((lesson) => ({ courseModule, lesson })),
    ),
  );

  await db.insert(lessons).values(
    allLessons.map(({ courseModule, lesson }) => ({
      id: lesson.id,
      tenantId,
      moduleId: courseModule.id,
      title: lesson.title,
      slug: lesson.slug,
      contentMd: `Lecture notes for ${lesson.title}.`,
      durationSeconds: lesson.durationSeconds,
      isFreePreview: lesson.isFreePreview,
      isPublished: lesson.isPublished,
      sortOrder: lesson.sortOrder,
    })),
  );

  // Object keys are always prefixed with the tenant (PRD section 5.5).
  //
  // WAV rather than mp3, because these keys now have real objects behind them
  // (see src/db/seed-media.ts) and a generated WAV needs no encoder. A key
  // whose extension disagreed with what was uploaded would be a trap for the
  // next person to look at the bucket.
  await db.insert(lessonResources).values(
    allLessons.map(({ lesson }) => ({
      id: lesson.resourceId,
      tenantId,
      lessonId: lesson.id,
      kind: 'audio' as const,
      storageKey: `t/${tenantId}/lessons/${lesson.id}/audio.wav`,
      filename: `${lesson.slug}.wav`,
      byteSize: 1_440_044,
      isDownloadable: true,
      sortOrder: 0,
    })),
  );

  for (const [index, { lesson }] of allLessons.entries()) {
    seedObjects.push({
      tenantId,
      key: `t/${tenantId}/lessons/${lesson.id}/audio.wav`,
      // Walking up a scale, so consecutive lessons are audibly different and
      // "did the right one start playing" is answerable by ear.
      pitchHz: 220 + index * 20,
    });
  }

  const adminUser = userByKey(tenant, 'admin');

  for (const enrollment of tenant.enrollments) {
    const user = userByKey(tenant, enrollment.userKey);
    const source =
      enrollment.sourceKind === 'program'
        ? programBySlug(tenant, enrollment.sourceSlug)
        : courseBySlug(tenant, enrollment.sourceSlug);

    await db.insert(enrollments).values({
      id: enrollment.id,
      tenantId,
      userId: user.id,
      sourceKind: enrollment.sourceKind,
      sourceId: source.id,
      grantedAt: daysFromNow(-45),
      expiresAt:
        enrollment.expiresInDays === null
          ? null
          : daysFromNow(enrollment.expiresInDays),
      grantedBy: enrollment.manuallyGranted ? adminUser.id : null,
    });

    if (enrollment.orderId) {
      const amountCents = source.priceCents;
      await db.insert(orders).values({
        id: enrollment.orderId,
        tenantId,
        userId: user.id,
        productId: source.productId,
        stripeSessionId: `cs_seed_${enrollment.id.slice(0, 12)}`,
        stripePaymentIntent: `pi_seed_${enrollment.id.slice(0, 12)}`,
        amountCents,
        applicationFeeCents: Math.round(
          (amountCents * tenant.applicationFeeBps) / 10_000,
        ),
        status: 'paid',
        createdAt: daysFromNow(-45),
      });
    }

    if (enrollment.manuallyGranted) {
      // Every manual grant is recorded (PRD section 10, P0-11).
      await db.insert(auditLog).values({
        id: seedUuid(`${tenant.slug}/audit/${enrollment.id}`),
        tenantId,
        actorUserId: adminUser.id,
        action: 'enrollment.granted',
        targetType: 'enrollment',
        targetId: enrollment.id,
        metadataJson: {
          reason: 'scholarship',
          sourceKind: enrollment.sourceKind,
          sourceSlug: enrollment.sourceSlug,
        },
        createdAt: daysFromNow(-45),
      });
    }
  }

  // A position for the person who studies at both institutes, on the same
  // course slug at each. Two rows, different numbers, and the primary key
  // includes tenant_id so they coexist: a read that lost its tenant filter
  // would show one institute how far this person got at the other.
  const sharedCourse = courseBySlug(tenant, 'old-testament-survey');
  const sharedLesson = sharedCourse.modules[0]?.lessons[1];
  if (sharedLesson) {
    await db.insert(progress).values({
      tenantId,
      userId: SHARED_STUDENT.id,
      lessonId: sharedLesson.id,
      positionSeconds: tenant.slug === 'grace' ? 412 : 77,
      updatedAt: daysFromNow(-1),
    });
  }

  // Partial playback, so resume has something to read back.
  const diploma = programBySlug(tenant, 'diploma-in-biblical-studies');
  const firstDiplomaCourseSlug = diploma.courseSlugs[0];
  if (firstDiplomaCourseSlug) {
    const course = courseBySlug(tenant, firstDiplomaCourseSlug);
    const gated = course.modules[0]?.lessons[1];
    if (gated) {
      await db.insert(progress).values({
        tenantId,
        userId: userByKey(tenant, 'student1').id,
        lessonId: gated.id,
        positionSeconds: 1275,
        updatedAt: daysFromNow(-2),
      });
    }
  }
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('refusing to seed with NODE_ENV=production');
  }

  await seedDatabase();

  const tenantSummary = SEED_TENANTS.map(
    (tenant) =>
      `  ${tenant.name} (${tenant.slug}): ${tenant.courses.length} courses, ` +
      `${tenant.programs.length} programs, ` +
      `${Object.keys(tenant.users).length} members`,
  ).join('\n');

  console.log(`seeded ${SEED_TENANTS.length} tenants\n${tenantSummary}`);
  console.log(
    `  shared identity: ${SHARED_STUDENT.email} is a member of both tenants`,
  );
  console.log(
    `\nsign in as any seeded person with the password ${SEED_PASSWORD}\n` +
      '  admin@gracebible.test, instructor@gracebible.test, student1@gracebible.test',
  );
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main()
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => closeAdminDb());
}
