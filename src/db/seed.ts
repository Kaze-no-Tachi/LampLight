import { pathToFileURL } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { closeAdminDb, getAdminDb } from './admin';
import { resetData } from './reset';
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
import {
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

export async function seedDatabase(): Promise<void> {
  const db = getAdminDb();

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

  for (const tenant of SEED_TENANTS) {
    await seedTenant(tenant);
  }
}

async function seedTenant(tenant: SeedTenant): Promise<void> {
  const db = getAdminDb();
  const tenantId = tenant.id;

  await db.insert(tenantSettings).values({
    tenantId,
    logoUrl: `https://cdn.lamplight.school/t/${tenantId}/logo.svg`,
    themeJson: { preset: 'classic', brand: '#1f3a5f', radius: '0.5rem' },
    copyJson: {
      hero: `Study at ${tenant.name}.`,
      about: `${tenant.name} trains men and women for faithful ministry.`,
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
      sortOrder: lesson.sortOrder,
    })),
  );

  // Object keys are always prefixed with the tenant (PRD section 5.5).
  await db.insert(lessonResources).values(
    allLessons.map(({ lesson }) => ({
      id: lesson.resourceId,
      tenantId,
      lessonId: lesson.id,
      kind: 'audio' as const,
      storageKey: `t/${tenantId}/lessons/${lesson.id}/audio.mp3`,
      filename: `${lesson.slug}.mp3`,
      byteSize: 18_400_000,
      isDownloadable: true,
      sortOrder: 0,
    })),
  );

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
