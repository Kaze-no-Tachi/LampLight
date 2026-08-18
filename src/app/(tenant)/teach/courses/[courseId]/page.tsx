import { and, eq } from 'drizzle-orm';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTenantDb } from '@/db/client';
import {
  listCourseResources,
  listCourseTags,
  listTagsForCourses,
} from '@/db/repositories/catalog';
import {
  countCourseEnrollments,
  listAssignableStaff,
} from '@/db/repositories/catalog-admin';
import {
  listLessonsForCourse,
  listResourcesForLessons,
} from '@/db/repositories/lessons';
import { courses, modules, products } from '@/db/schema';
import { decideCourseAuthoring } from '@/lib/access/authoring';
import { requireViewer } from '@/lib/auth/guards';
import { listCourseInstructors } from '@/db/repositories/catalog';
import type { StaffModule } from '../../../lesson-list';
import { LessonList } from '../../../lesson-list';
import { Attachments } from '../../attachments';
import { addCourseLinkAction } from '../../edit-actions';
import { ArchiveCourseButton } from './archive-course-button';
import { CourseSettings } from './course-settings';

/**
 * Course settings (mockup 9), which is also the one editor round 2 built.
 *
 * The mockup drew this screen as publish state, the course's own fields, and
 * a list of sections. Everything under those three was already here and is
 * kept rather than dropped to match a drawing: the syllabus attachments, the
 * per-lesson controls (publish, reorder, archive), and archiving the course.
 * A reskin that quietly removed working authoring would be a worse outcome
 * than a screen that is longer than its mockup.
 *
 * The predicate decides, not the route. An instructor who types a course id
 * they are not assigned to, or an id that is archived, gets the same 404 as
 * one that does not exist.
 */
export const dynamic = 'force-dynamic';

export default async function CourseSettingsPage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const viewer = await requireViewer();
  const { courseId } = await params;
  const isAdmin = viewer.role === 'admin';

  const data = await getTenantDb(viewer.tenant.id).run(async (scope) => {
    const decision = await decideCourseAuthoring(
      scope,
      { tenantId: viewer.tenant.id, userId: viewer.userId },
      courseId,
    );
    if (!decision.allowed) return null;

    const [course] = await scope.tx
      .select({
        id: courses.id,
        title: courses.title,
        slug: courses.slug,
        descriptionMd: courses.descriptionMd,
        isStandalonePurchasable: courses.isStandalonePurchasable,
        priceCents: products.priceCents,
        isPublished: products.isPublished,
      })
      .from(courses)
      .innerJoin(
        products,
        and(
          eq(products.tenantId, scope.tenantId),
          eq(products.id, courses.productId),
        ),
      )
      .where(
        and(eq(courses.tenantId, scope.tenantId), eq(courses.id, courseId)),
      )
      .limit(1);

    if (!course) return null;

    const courseModules = await scope.tx
      .select({ id: modules.id, title: modules.title })
      .from(modules)
      .where(
        and(
          eq(modules.tenantId, scope.tenantId),
          eq(modules.courseId, courseId),
        ),
      )
      .orderBy(modules.sortOrder);

    // Drafts included, staff sees them; archived is never included, hidden
    // from an author the same way it is hidden from a student.
    const lessons = await listLessonsForCourse(scope, courseId, {
      includeUnpublished: true,
    });

    // One query for every lesson's attachments rather than one per lesson,
    // and only the audio is read out of it: "no audio" is the state this
    // screen is for finding.
    const lessonResources = await listResourcesForLessons(
      scope,
      lessons.map((lesson) => lesson.id),
    );
    const withAudio = new Set(
      lessonResources
        .filter((resource) => resource.kind === 'audio')
        .map((resource) => resource.lessonId),
    );

    const staffModules: StaffModule[] = courseModules.map((courseModule) => {
      const inModule = lessons.filter(
        (lesson) => lesson.moduleId === courseModule.id,
      );
      return {
        id: courseModule.id,
        title: courseModule.title,
        lessons: inModule.map((lesson, index) => ({
          id: lesson.id,
          title: lesson.title,
          isFreePreview: lesson.isFreePreview,
          isPublished: lesson.isPublished,
          durationSeconds: lesson.durationSeconds,
          hasAudio: withAudio.has(lesson.id),
          isFirst: index === 0,
          isLast: index === inModule.length - 1,
        })),
      };
    });

    const instructors = await listCourseInstructors(scope, courseId);

    return {
      course,
      staffModules,
      tags: (await listTagsForCourses(scope, [courseId])).map(
        (tag) => tag.label,
      ),
      // Read for everybody, unlike the roster below: tagging is part of what
      // a course says, which an assigned instructor writes.
      vocabulary: (await listCourseTags(scope)).map((tag) => tag.label),
      instructors: instructors.map((person) => ({
        userId: person.userId,
        // A member who never set a name is shown by the address they signed
        // up with, which is the only thing anybody can identify them by.
        name: person.name ?? person.email,
        email: person.email,
      })),
      // Only an admin gets a roster to pick from, so only an admin's page
      // pays for the query.
      assignableStaff: isAdmin
        ? (await listAssignableStaff(scope)).filter(
            (person) =>
              !instructors.some(
                (assigned) => assigned.userId === person.userId,
              ),
          )
        : [],
      resources: await listCourseResources(scope, courseId),
      enrolledCount: await countCourseEnrollments(scope, courseId),
    };
  });

  if (!data) notFound();

  const manySections = data.staffModules.length > 1;

  return (
    <div className="flex max-w-[820px] flex-col gap-6">
      <Link
        href="/teach"
        className="text-muted-foreground w-fit text-(length:--text-label) font-medium underline-offset-4 hover:underline"
      >
        Teaching
      </Link>

      <CourseSettings
        course={{
          id: data.course.id,
          title: data.course.title,
          slug: data.course.slug,
          descriptionMd: data.course.descriptionMd,
          isPublished: data.course.isPublished,
          priceCents: data.course.priceCents,
          isStandalonePurchasable: data.course.isStandalonePurchasable,
          tags: data.tags,
          instructors: data.instructors,
        }}
        isAdmin={isAdmin}
        tagVocabulary={data.vocabulary}
        assignableStaff={data.assignableStaff}
        host={viewer.tenant.host}
      />

      <section className="border-border bg-card flex flex-col gap-3.5 rounded-(--radius) border px-6 py-[22px]">
        <div className="flex flex-wrap items-baseline justify-between gap-4">
          <h2 className="text-(length:--text-row-title) leading-tight">
            {manySections ? 'Sections' : 'Lessons'}
          </h2>
          <div className="flex items-center gap-4">
            <Link
              href={`/catalogue/${data.course.slug}`}
              className="text-muted-foreground text-(length:--text-label) font-medium underline-offset-4 hover:underline"
            >
              See what students see
            </Link>
            <Link
              href={`/teach/courses/${data.course.id}/lessons/new`}
              className="text-primary text-(length:--text-label) font-medium underline-offset-4 hover:underline"
            >
              Add a lesson
            </Link>
          </div>
        </div>

        <LessonList
          mode="staff"
          modules={data.staffModules}
          showModuleHeadings={manySections}
        />
      </section>

      <Attachments
        target={{ kind: 'course', id: data.course.id }}
        addLink={addCourseLinkAction}
        title="Syllabus and handouts"
        description="Anything marked open to everyone shows on the course page before somebody enrols, which is what a syllabus is for. The rest is for enrolled students."
        showVisibility
        attachments={data.resources.map((resource) => ({
          id: resource.id,
          kind: resource.kind,
          label: resource.title,
          byteSize: resource.byteSize,
          url: resource.url,
          isPublic: resource.isPublic,
        }))}
      />

      {/*
        Grading, assessments and a per-course roster are not built. They used
        to be admitted to on every card of the teaching list, which meant
        saying it six times on one screen; here it is said once, on the screen
        somebody is actually working a course from. A card that never mentions
        them reads as though nothing else is planned, and a link that would
        404 is worse than a label that says so honestly.
      */}
      <section className="border-border text-muted-foreground grid gap-3 rounded-(--radius) border border-dashed px-6 py-5 sm:grid-cols-3">
        <ComingSoon
          title="Grading"
          body="Scoring what students turn in, once assessments exist to score."
        />
        <ComingSoon
          title="Assessments"
          body="Quizzes and exams attached to a lesson or the course as a whole."
        />
        <ComingSoon
          title="Roster"
          body="Who is enrolled here and how they are getting on, from this course's own view."
        />
      </section>

      {isAdmin && (
        <section className="border-border bg-card flex flex-col gap-3 rounded-(--radius) border px-6 py-[22px]">
          <h2 className="text-(length:--text-row-title) leading-tight">
            Retire this course
          </h2>
          <p className="text-muted-foreground max-w-[70ch] text-(length:--text-label) leading-[1.55]">
            Archiving takes it off the catalogue and every list, for good: there
            is no way back from here. Nothing is deleted, so anyone already
            enrolled keeps their record and their progress.
          </p>
          <ArchiveCourseButton
            courseId={data.course.id}
            courseTitle={data.course.title}
            enrolledCount={data.enrolledCount}
          />
        </section>
      )}
    </div>
  );
}

function ComingSoon({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col gap-1 text-(length:--text-label)">
      <span className="text-foreground font-medium">{title}</span>
      <span className="leading-[1.5]">Coming soon. {body}</span>
    </div>
  );
}
