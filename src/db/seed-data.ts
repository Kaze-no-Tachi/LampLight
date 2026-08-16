import { createHash } from 'node:crypto';

/**
 * The seed fixture.
 *
 * Two tenants are built from the same template on purpose, so that every
 * human-readable identifier collides across them: identical course slugs,
 * identical program slugs, identical lesson titles, identical module
 * structure. If a query ever loses its tenant filter, it does not return
 * obviously foreign data that a test might overlook. It returns something that
 * looks exactly like what the caller expected, which is the failure mode the
 * isolation suite has to be able to catch.
 *
 * Identifiers are derived deterministically from names, so the same seed run
 * twice produces the same UUIDs and tests can refer to fixture rows by
 * meaning rather than by index.
 */

/** UUID v5 style derivation. Stable across runs and machines. */
export function seedUuid(name: string): string {
  const digest = createHash('sha1').update(`lectern.seed:${name}`).digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes.writeUInt8((bytes.readUInt8(6) & 0x0f) | 0x50, 6);
  bytes.writeUInt8((bytes.readUInt8(8) & 0x3f) | 0x80, 8);
  const hex = bytes.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

export type SeedRole = 'student' | 'instructor' | 'admin';

export type SeedUser = {
  id: string;
  email: string;
  name: string;
  role: SeedRole;
};

export type SeedLesson = {
  id: string;
  slug: string;
  title: string;
  isFreePreview: boolean;
  sortOrder: number;
  durationSeconds: number;
  resourceId: string;
};

export type SeedModule = {
  id: string;
  title: string;
  sortOrder: number;
  lessons: SeedLesson[];
};

export type SeedCourse = {
  id: string;
  productId: string;
  slug: string;
  title: string;
  isStandalonePurchasable: boolean;
  isPublished: boolean;
  priceCents: number;
  modules: SeedModule[];
};

export type SeedProgram = {
  id: string;
  productId: string;
  slug: string;
  title: string;
  priceCents: number;
  courseSlugs: string[];
};

export type SeedDomain = {
  id: string;
  hostname: string;
  isPrimary: boolean;
  verificationStatus: 'pending' | 'verifying' | 'active' | 'failed';
};

export type SeedEnrollment = {
  id: string;
  /** Key into the tenant's user set. */
  userKey: string;
  sourceKind: 'program' | 'course';
  /** Slug of the program or course the entitlement is against. */
  sourceSlug: string;
  /** Null means no expiry. Negative means already expired. */
  expiresInDays: number | null;
  /** True means an admin granted it manually, so granted_by is set. */
  manuallyGranted: boolean;
  orderId: string | null;
};

export type SeedTenant = {
  id: string;
  slug: string;
  name: string;
  applicationFeeBps: number;
  domains: SeedDomain[];
  users: Record<string, SeedUser>;
  programs: SeedProgram[];
  courses: SeedCourse[];
  /** Course slugs the tenant's instructor is assigned to. */
  instructorCourseSlugs: string[];
  enrollments: SeedEnrollment[];
};

const COURSE_TEMPLATE: {
  slug: string;
  title: string;
  isStandalonePurchasable: boolean;
  isPublished: boolean;
}[] = [
  {
    slug: 'old-testament-survey',
    title: 'Old Testament Survey',
    isStandalonePurchasable: true,
    isPublished: true,
  },
  {
    slug: 'new-testament-survey',
    title: 'New Testament Survey',
    isStandalonePurchasable: true,
    isPublished: true,
  },
  {
    slug: 'systematic-theology-i',
    title: 'Systematic Theology I',
    isStandalonePurchasable: true,
    isPublished: true,
  },
  {
    slug: 'church-history',
    title: 'Church History',
    isStandalonePurchasable: true,
    isPublished: true,
  },
  {
    slug: 'hermeneutics',
    title: 'Hermeneutics',
    isStandalonePurchasable: true,
    isPublished: true,
  },
  {
    // Sold only inside the certificate program, and left unpublished so the
    // catalog repository has an unpublished row to filter out.
    slug: 'pastoral-ministry',
    title: 'Pastoral Ministry',
    isStandalonePurchasable: false,
    isPublished: false,
  },
];

const PROGRAM_TEMPLATE: { slug: string; title: string; courseSlugs: string[] }[] =
  [
    {
      slug: 'diploma-in-biblical-studies',
      title: 'Diploma in Biblical Studies',
      courseSlugs: [
        'old-testament-survey',
        'new-testament-survey',
        'systematic-theology-i',
      ],
    },
    {
      slug: 'certificate-in-ministry',
      title: 'Certificate in Ministry',
      courseSlugs: ['church-history', 'hermeneutics', 'pastoral-ministry'],
    },
  ];

const MODULES_PER_COURSE = 2;
const LESSONS_PER_MODULE = 2;

function buildCourses(tenantSlug: string): SeedCourse[] {
  return COURSE_TEMPLATE.map((course) => {
    const key = `${tenantSlug}/course/${course.slug}`;

    const modules: SeedModule[] = Array.from(
      { length: MODULES_PER_COURSE },
      (_unused, moduleIndex) => {
        const moduleKey = `${key}/module/${moduleIndex + 1}`;

        const lessons: SeedLesson[] = Array.from(
          { length: LESSONS_PER_MODULE },
          (_unusedLesson, lessonIndex) => {
            const ordinal = moduleIndex * LESSONS_PER_MODULE + lessonIndex + 1;
            const lessonKey = `${moduleKey}/lesson/${ordinal}`;
            return {
              id: seedUuid(lessonKey),
              slug: `lesson-${ordinal}`,
              title: `${course.title}, Lesson ${ordinal}`,
              // The first lesson of every course is open to everyone, which is
              // branch 2 of the access predicate.
              isFreePreview: ordinal === 1,
              sortOrder: lessonIndex,
              durationSeconds: 2400 + ordinal * 60,
              resourceId: seedUuid(`${lessonKey}/audio`),
            };
          },
        );

        return {
          id: seedUuid(moduleKey),
          title: `Module ${moduleIndex + 1}`,
          sortOrder: moduleIndex,
          lessons,
        };
      },
    );

    return {
      id: seedUuid(key),
      productId: seedUuid(`${key}/product`),
      slug: course.slug,
      title: course.title,
      isStandalonePurchasable: course.isStandalonePurchasable,
      isPublished: course.isPublished,
      priceCents: 29900,
      modules,
    };
  });
}

function buildPrograms(tenantSlug: string): SeedProgram[] {
  return PROGRAM_TEMPLATE.map((program) => {
    const key = `${tenantSlug}/program/${program.slug}`;
    return {
      id: seedUuid(key),
      productId: seedUuid(`${key}/product`),
      slug: program.slug,
      title: program.title,
      priceCents: 149900,
      courseSlugs: program.courseSlugs,
    };
  });
}

/**
 * One user identity that holds a membership at both tenants, which is the
 * cross-tenant identity case from PRD section 5.4. Any read path that leaks
 * this person's enrollments from one tenant into the other is a real bug that
 * per-tenant fixtures alone would not surface.
 */
export const SHARED_STUDENT: SeedUser = {
  id: seedUuid('user/shared-student'),
  email: 'shared.student@example.test',
  name: 'Dana Whitfield',
  role: 'student',
};

export const PLATFORM_OPERATOR: SeedUser = {
  id: seedUuid('user/platform-operator'),
  email: 'operator@romanservices.test',
  name: 'Platform Operator',
  role: 'admin',
};

function buildUsers(
  tenantSlug: string,
  emailDomain: string,
): Record<string, SeedUser> {
  const make = (key: string, local: string, name: string, role: SeedRole) => ({
    id: seedUuid(`${tenantSlug}/user/${key}`),
    email: `${local}@${emailDomain}`,
    name,
    role,
  });

  return {
    admin: make('admin', 'admin', 'Institute Admin', 'admin'),
    instructor: make('instructor', 'instructor', 'Lead Instructor', 'instructor'),
    student1: make('student1', 'student1', 'First Student', 'student'),
    student2: make('student2', 'student2', 'Second Student', 'student'),
    // Same person as at the other tenant, deliberately.
    shared: SHARED_STUDENT,
  };
}

function buildEnrollments(tenantSlug: string): SeedEnrollment[] {
  const id = (key: string) => seedUuid(`${tenantSlug}/enrollment/${key}`);
  const order = (key: string) => seedUuid(`${tenantSlug}/order/${key}`);

  return [
    // Purchased a whole program: entitled to every course inside it.
    {
      id: id('student1-diploma'),
      userKey: 'student1',
      sourceKind: 'program',
      sourceSlug: 'diploma-in-biblical-studies',
      expiresInDays: null,
      manuallyGranted: false,
      orderId: order('student1-diploma'),
    },
    // Purchased a single course: entitled to that course only, and explicitly
    // not to the rest of the program it belongs to.
    {
      id: id('student2-church-history'),
      userKey: 'student2',
      sourceKind: 'course',
      sourceSlug: 'church-history',
      expiresInDays: null,
      manuallyGranted: false,
      orderId: order('student2-church-history'),
    },
    // Scholarship: granted by an admin with no payment and a future expiry.
    {
      id: id('student2-certificate-scholarship'),
      userKey: 'student2',
      sourceKind: 'program',
      sourceSlug: 'certificate-in-ministry',
      expiresInDays: 180,
      manuallyGranted: true,
      orderId: null,
    },
    // Lapsed: must read exactly like no entitlement at all.
    {
      id: id('shared-expired-ot'),
      userKey: 'shared',
      sourceKind: 'course',
      sourceSlug: 'old-testament-survey',
      expiresInDays: -30,
      manuallyGranted: false,
      orderId: order('shared-expired-ot'),
    },
    // The sharpest isolation case in the fixture.
    //
    // The shared student holds this same active entitlement at BOTH tenants.
    // So when the suite asks "does this user have access to the OTHER tenant's
    // hermeneutics course", a correctly scoped query says no, while a query
    // that lost its tenant filter finds the other tenant's enrollment row and
    // says yes. Without a user who exists on both sides, that mistake would be
    // invisible: the user simply would not be found either way.
    {
      id: id('shared-hermeneutics'),
      userKey: 'shared',
      sourceKind: 'course',
      sourceSlug: 'hermeneutics',
      expiresInDays: null,
      manuallyGranted: false,
      orderId: order('shared-hermeneutics'),
    },
  ];
}

function buildTenant(
  slug: string,
  name: string,
  emailDomain: string,
  applicationFeeBps: number,
  domains: Omit<SeedDomain, 'id'>[],
): SeedTenant {
  return {
    id: seedUuid(`tenant/${slug}`),
    slug,
    name,
    applicationFeeBps,
    domains: domains.map((domain) => ({
      ...domain,
      id: seedUuid(`${slug}/domain/${domain.hostname}`),
    })),
    users: buildUsers(slug, emailDomain),
    programs: buildPrograms(slug),
    courses: buildCourses(slug),
    // Assigned to the first three courses only, so "blocked from editing
    // courses I am not assigned to" has a negative case to test against.
    instructorCourseSlugs: [
      'old-testament-survey',
      'new-testament-survey',
      'systematic-theology-i',
    ],
    enrollments: buildEnrollments(slug),
  };
}

export const GRACE = buildTenant(
  'grace',
  'Grace Bible Institute',
  'gracebible.test',
  // Design partner, so no application fee.
  0,
  [
    {
      hostname: 'grace.lectern.app',
      isPrimary: false,
      verificationStatus: 'active',
    },
    {
      hostname: 'learn.gracebible.test',
      isPrimary: true,
      verificationStatus: 'active',
    },
  ],
);

export const CORNERSTONE = buildTenant(
  'cornerstone',
  'Cornerstone Baptist Institute',
  'cornerstone.test',
  250,
  [
    {
      hostname: 'cornerstone.lectern.app',
      isPrimary: true,
      verificationStatus: 'active',
    },
    {
      // Still waiting on DNS, so it must not resolve to the tenant.
      hostname: 'learn.cornerstone.test',
      isPrimary: false,
      verificationStatus: 'pending',
    },
  ],
);

export const SEED_TENANTS: SeedTenant[] = [GRACE, CORNERSTONE];

/** Lookup helpers that fail loudly rather than returning undefined. */
export function courseBySlug(tenant: SeedTenant, slug: string): SeedCourse {
  const course = tenant.courses.find((candidate) => candidate.slug === slug);
  if (!course) {
    throw new Error(`seed fixture has no course "${slug}" in ${tenant.slug}`);
  }
  return course;
}

export function programBySlug(tenant: SeedTenant, slug: string): SeedProgram {
  const program = tenant.programs.find((candidate) => candidate.slug === slug);
  if (!program) {
    throw new Error(`seed fixture has no program "${slug}" in ${tenant.slug}`);
  }
  return program;
}

export function userByKey(tenant: SeedTenant, key: string): SeedUser {
  const user = tenant.users[key];
  if (!user) {
    throw new Error(`seed fixture has no user "${key}" in ${tenant.slug}`);
  }
  return user;
}

export function firstLesson(course: SeedCourse): SeedLesson {
  const lesson = course.modules[0]?.lessons[0];
  if (!lesson) {
    throw new Error(`seed fixture course ${course.slug} has no lessons`);
  }
  return lesson;
}

/** The first non-preview lesson, which is the one access is actually gated on. */
export function firstGatedLesson(course: SeedCourse): SeedLesson {
  for (const courseModule of course.modules) {
    for (const lesson of courseModule.lessons) {
      if (!lesson.isFreePreview) {
        return lesson;
      }
    }
  }
  throw new Error(`seed fixture course ${course.slug} has no gated lesson`);
}
