import Link from 'next/link';
import { Panel } from 'rsuite';
import { getTenantDb } from '@/db/client';
import {
  listCourseStats,
  listCourseTags,
  listPublishedCourses,
  listPublishedPrograms,
  listTagsForCourses,
} from '@/db/repositories/catalog';
import { listEnrolledCourses } from '@/db/repositories/entitlements';
import { getViewer } from '@/lib/auth/guards';
import { courseMeta, excerpt, money } from '@/lib/format';
import { requireTenant } from '@/lib/tenancy/context';
import { loadBranding } from '@/lib/theme/branding';
import { CatalogueList, type CatalogueRow } from './catalogue-list';

/**
 * The catalogue. Public, because a bible institute wants its courses findable.
 *
 * Only published rows appear, which the repository enforces, so an institute
 * can draft a course without it showing up. What a visitor sees here is titles
 * and prices; what they can actually hear is decided per lesson by the access
 * predicate, so nothing on this page needs to know who is looking.
 *
 * Enrolled courses live on the shelf at /courses, not here: this page answers
 * "what does this institute offer", the shelf answers "what am I part way
 * through". A signed-in member sees a link to the shelf and a state on each
 * row, rather than their progress reproduced on this page.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Catalogue' };

/**
 * How a course reads to this particular viewer.
 *
 * The order matters and encodes the design's states. Enrolment is checked
 * before price, so someone already enrolled sees "Enrolled, Included" rather
 * than being quoted a price again. Program-only comes before the open case,
 * because a course sold only inside a program has no price of its own to show.
 *
 * Enrolling itself ignores price (round 2 decision, see catalogue/actions.ts),
 * so the price here is what the course is worth rather than a paywall.
 */
function stateFor(
  course: {
    id: string;
    isStandalonePurchasable: boolean;
    priceCents: number;
    currency: string;
  },
  enrolledIds: Set<string>,
): Pick<CatalogueRow, 'stateLabel' | 'stateColor' | 'priceLabel'> {
  if (enrolledIds.has(course.id)) {
    return { stateLabel: 'Enrolled', stateColor: 'green', priceLabel: 'Included' };
  }
  if (course.priceCents === 0) {
    return { stateLabel: 'Free', stateColor: 'green', priceLabel: 'Free' };
  }
  if (!course.isStandalonePurchasable) {
    return { stateLabel: 'In the program', stateColor: null, priceLabel: '' };
  }
  return {
    stateLabel: 'Open to enrol',
    stateColor: 'blue',
    priceLabel: money(course.priceCents, course.currency),
  };
}

export default async function CataloguePage() {
  const tenant = await requireTenant();
  const branding = await loadBranding(tenant);
  const viewer = await getViewer();

  const { courses, programs, tags, courseTags, stats, enrolled } =
    await getTenantDb(tenant.id).run(async (scope) => {
      const courses = await listPublishedCourses(scope);
      const courseIds = courses.map((course) => course.id);

      return {
        courses,
        programs: await listPublishedPrograms(scope),
        tags: await listCourseTags(scope),
        courseTags: await listTagsForCourses(scope, courseIds),
        stats: await listCourseStats(scope, courseIds),
        // Entitlements are read per request and never cached across viewers.
        enrolled: viewer ? await listEnrolledCourses(scope, viewer.userId) : [],
      };
    });

  const enrolledIds = new Set(enrolled.map((row) => row.courseId));
  const statsById = new Map(stats.map((row) => [row.courseId, row]));
  // Entitlement rows name the program they came through by title rather than
  // by id, so that is what a program row can be matched against here.
  const enrolledProgramTitles = new Set(
    enrolled.filter((row) => row.via === 'program').map((row) => row.sourceTitle),
  );

  const tagsByCourse = new Map<string, typeof courseTags>();
  for (const link of courseTags) {
    const list = tagsByCourse.get(link.courseId) ?? [];
    list.push(link);
    tagsByCourse.set(link.courseId, list);
  }

  const rows: CatalogueRow[] = courses.map((course) => {
    const stat = statsById.get(course.id);
    return {
      id: course.id,
      slug: course.slug,
      title: course.title,
      blurb: excerpt(course.descriptionMd),
      meta: courseMeta(stat?.lessonCount ?? 0, stat?.durationSeconds ?? null),
      tags: (tagsByCourse.get(course.id) ?? []).map((tag) => ({
        id: tag.id,
        slug: tag.slug,
        label: tag.label,
      })),
      ...stateFor(course, enrolledIds),
    };
  });

  return (
    <main className="mx-auto flex w-full max-w-[1080px] flex-col gap-14 px-8 pt-14 pb-24">
      <section className="flex max-w-[60ch] flex-col gap-3.5">
        <span className="text-muted-foreground text-(length:--text-meta) font-semibold tracking-[0.14em] uppercase">
          {branding.copy.tagline}
        </span>
        <h1 className="text-(length:--text-hero) leading-[1.15] tracking-[-0.01em]">
          {branding.copy.hero}
        </h1>
        <p className="text-muted-foreground text-(length:--text-body) leading-[1.65]">
          {branding.copy.about}
        </p>
        {viewer ? (
          <p className="text-muted-foreground text-(length:--text-label)">
            Signed in as {viewer.email}.{' '}
            <Link href="/courses" className="underline underline-offset-4">
              Your enrolled courses are on your shelf.
            </Link>
          </p>
        ) : null}
      </section>

      {programs.length > 0 ? (
        <section className="flex flex-col gap-[18px]">
          <div className="border-border flex flex-wrap items-baseline justify-between gap-4 border-b pb-3">
            <h2 className="text-(length:--text-section) leading-tight">
              Programs of study
            </h2>
            <span className="text-muted-foreground text-(length:--text-label)">
              One enrolment. Every course inside it.
            </span>
          </div>

          {programs.map((program) => (
            <Panel key={program.id} bordered className="bg-card">
              <div className="flex flex-wrap items-start gap-7">
                <div className="flex min-w-0 flex-1 flex-col gap-2.5">
                  <h3 className="text-(length:--text-card-title) leading-tight">
                    {program.title}
                  </h3>
                  {program.descriptionMd ? (
                    <p className="text-muted-foreground max-w-[62ch] text-(length:--text-ui) leading-[1.6]">
                      {excerpt(program.descriptionMd, 200)}
                    </p>
                  ) : null}
                  <span className="text-muted-foreground text-(length:--text-label)">
                    {program.courseCount}{' '}
                    {program.courseCount === 1 ? 'course' : 'courses'} · every
                    lesson inside, self-paced
                  </span>
                </div>

                <div className="flex min-w-[150px] flex-col items-end gap-2.5">
                  <span className="font-serif text-(length:--text-section) leading-none">
                    {money(program.priceCents)}
                  </span>
                  {/*
                    No enrol button here. Enrolment is per course (see
                    catalogue/[slug]/enroll-button.tsx); a program is a
                    description of what is inside rather than something with
                    its own action, until a program-level enrolment exists.
                  */}
                  <span className="text-muted-foreground text-right text-(length:--text-meta)">
                    {enrolledProgramTitles.has(program.title)
                      ? 'You are enrolled.'
                      : 'Enrol course by course.'}
                  </span>
                </div>
              </div>
            </Panel>
          ))}
        </section>
      ) : null}

      <section className="flex flex-col gap-[18px]">
        <div className="border-border flex flex-wrap items-baseline justify-between gap-4 border-b pb-3">
          <h2 className="text-(length:--text-section) leading-tight">Courses</h2>
          <span className="text-muted-foreground text-(length:--text-label)">
            Every course opens with a lesson you can hear without an account.
          </span>
        </div>

        {rows.length === 0 ? (
          <p className="text-muted-foreground text-(length:--text-ui)">
            Nothing published yet. Check back soon.
          </p>
        ) : (
          <CatalogueList courses={rows} tags={tags} />
        )}
      </section>
    </main>
  );
}
