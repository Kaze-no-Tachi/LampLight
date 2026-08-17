import Link from 'next/link';

type Course = {
  id: string;
  title: string;
  enrolledCount: number;
};

/**
 * One assigned course, summarised (round 2, chunk 4).
 *
 * Everything this used to render inline, modules and lessons and the audio
 * upload widget among them, moved to /courses/[courseId]/edit in chunk 3.
 * What is left here is what belongs on a list: which course, how many people
 * hold it, and the one link into the workspace.
 *
 * Grading, Assessments and Roster are not built. They are shown anyway,
 * because a card that only ever offers "Manage lessons" reads as though
 * nothing else is planned, and a link that would 404 is worse than a label
 * that says so honestly.
 */
export function TeachCourse({ course }: { course: Course }) {
  return (
    <section className="flex flex-col gap-4 rounded-lg border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-tight">{course.title}</h2>
        <span className="text-muted-foreground text-sm">
          {course.enrolledCount === 1
            ? '1 person enrolled'
            : `${course.enrolledCount} people enrolled`}
        </span>
      </div>

      <Link
        href={`/courses/${course.id}/edit`}
        className="bg-primary text-primary-foreground self-start rounded-md px-4 py-2 text-sm font-medium"
      >
        Manage lessons
      </Link>

      <div className="grid gap-3 sm:grid-cols-3">
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
      </div>
    </section>
  );
}

function ComingSoon({ title, body }: { title: string; body: string }) {
  return (
    <div className="border-muted text-muted-foreground flex flex-col gap-1 rounded-md border border-dashed p-3 text-sm">
      <span className="text-foreground font-medium">{title}</span>
      <span>Coming soon. {body}</span>
    </div>
  );
}
