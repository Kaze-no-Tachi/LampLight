import Link from 'next/link';

export type CourseShapeCounts = {
  moduleCount: number;
  lessonCount: number;
  awaitingAudio: number;
};

export type Course = {
  id: string;
  title: string;
  enrolledCount: number;
  /** Sections, lessons, and how many still need a recording. */
  shape: CourseShapeCounts;
  tags: string[];
  /**
   * Present for an admin, absent for an instructor. Whether students can see
   * a course is the institute's call, not any one instructor's, the same
   * reasoning settings/catalog/page.tsx used to state before /teach replaced
   * it (round 2, chunk 5).
   */
  isPublished?: boolean;
};

/**
 * One course, as a row on the teaching list (mockup 5).
 *
 * A server component now, and nearly empty of behaviour. It used to carry the
 * publish button and the whole instructor roster, which put three write
 * actions and a select on every card of a list. Both moved to course settings
 * (mockup 9), where there is room to say what they mean and where somebody
 * making that kind of decision is already standing. What is left is what
 * belongs on a list: which course, what shape it is in, whether students can
 * see it, and the one way in.
 *
 * The mockup also draws a lesson row per lesson here. Confirmed with Jeremy
 * that the count line stays instead: round 2 moved lessons off this screen on
 * purpose, course settings gives them a better home than a list row can, and
 * a twelve-lesson course would otherwise make a card nobody can scan past.
 */

/**
 * "2 sections, 7 lessons, 1 waiting on audio".
 *
 * Clauses that would read as zero are dropped rather than printed: "0 waiting
 * on audio" is noise on the courses that are finished, which is most of them,
 * and it buries the one course that is not.
 */
function shapeLine(shape: CourseShapeCounts): string {
  const parts = [
    `${shape.moduleCount} ${shape.moduleCount === 1 ? 'section' : 'sections'}`,
    `${shape.lessonCount} ${shape.lessonCount === 1 ? 'lesson' : 'lessons'}`,
  ];
  if (shape.awaitingAudio > 0) {
    parts.push(`${shape.awaitingAudio} waiting on audio`);
  }
  return parts.join(' · ');
}

export function TeachCourse({ course }: { course: Course }) {
  return (
    <section
      data-testid="course-card"
      className="border-border bg-card flex flex-wrap items-center gap-4 rounded-(--radius) border px-6 py-5"
    >
      <div className="flex min-w-60 flex-1 flex-col gap-1.5">
        <h2 className="text-(length:--text-row-title) leading-tight">
          {course.title}
        </h2>

        <span className="text-muted-foreground text-(length:--text-label)">
          {shapeLine(course.shape)}
          {' · '}
          {course.enrolledCount === 1
            ? '1 person enrolled'
            : `${course.enrolledCount} people enrolled`}
        </span>

        {course.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {course.tags.map((tag) => (
              <span
                key={tag}
                className="bg-muted text-muted-foreground rounded-full px-2.5 py-1 text-[0.71875rem] leading-none font-medium whitespace-nowrap"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      {course.isPublished !== undefined && (
        // A pill rather than loose grey text: whether students can see a
        // course is the fact this row exists to report.
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-[0.71875rem] leading-none font-medium ${
            course.isPublished
              ? 'bg-accent text-accent-foreground'
              : 'bg-muted text-muted-foreground'
          }`}
        >
          {course.isPublished ? 'Published' : 'Draft'}
        </span>
      )}

      <Link
        href={`/teach/courses/${course.id}`}
        className="border-border hover:border-primary shrink-0 rounded-(--radius) border px-[13px] py-2 text-(length:--text-label) font-medium transition-colors"
      >
        Course settings
      </Link>
    </section>
  );
}
