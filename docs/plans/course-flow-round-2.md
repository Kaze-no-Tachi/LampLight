# Course and lesson flow, round 2

## Context

The catalogue and authoring screens went in today in two rushed passes, and the
shape is wrong: `/courses` is the public shelf with no student shelf anywhere,
course editing lives under `/teach` while course creation lives under
`/settings/catalog`, lessons cannot be published, reordered or removed, and
students cannot enrol themselves at all. This is a continuation of that work,
not a new build.

Decisions taken with the user before planning:

- **Enroll works on any published course**, ignoring price. Payments are not
  built, so nothing is bypassed yet, but a priced course is given away until
  they are. Accepted knowingly.
- **URLs move with no redirects.** Existing `/courses/<slug>` links break.
- **Delete archives rather than destroys.** Rows survive, the course disappears
  everywhere and frees its slug, and the enrolled count is shown first.

## A bug to fix first, found while mapping

`findCourseBySlug` (`src/db/repositories/catalog.ts:58`) does not filter on
`products.isPublished`, unlike `listPublishedCourses` beside it. The comment on
the public course page claims an unpublished course is "not found", but it is
reachable by slug: title, description and public course documents all render.
Only lesson audio is protected, by `decideLessonAccess`.

Today's browser test asserted the course was absent from the catalogue _list_
and never tried the direct URL, so it passed. Fix the query and cover the
direct URL.

## The map

**Routes today** (all under `src/app/(tenant)`): `/courses` public catalogue,
`/courses/[slug]` public course, `/lessons/[lessonId]` predicate-gated,
`/teach` staff list, `/teach/courses/[courseId]` editor,
`/teach/lessons/[lessonId]` lesson editor, `/settings/catalog` admin CRUD,
`/account` own shelf and profile.

**Duplication to collapse**: three separate lesson-list renderings (student at
`courses/[slug]/page.tsx`, editor inline at `teach/courses/[courseId]`, and
`LessonRow` in `teach/lesson-row.tsx`), the free-preview badge in four places,
two near-identical XHR uploaders (`teach/lesson-row.tsx`, `teach/attachments.tsx`),
two markdown editor blocks, two duration formatters.

**Data model**: `courses` has no published flag; publication lives on
`products.is_published` reached through `courses.product_id`. `lessons` has
`is_free_preview` and `sort_order` but **no published flag**. `progress`
(tenant, user, lesson) carries `position_seconds` and a nullable `completed_at`
that is sticky. `enrollments` is the entitlement table, unique per
(tenant, user, source_kind, source_id), with `granted_by` null meaning purchase.
`program_courses` links programs to courses; `course_instructors` is the
assignment table. **No delete or archive path exists for any content.** Nothing
is faked in client state; everything already persists.

**Role checks**: every server action already calls `requireViewer`/`requireRole`
first and then a `decide*` predicate. The one inline comparison is
`teach/page.tsx:25` (`viewer.role === 'student'`).

## Progress

- [x] **Chunk 1, foundations.** `can()` facade, `lessons.is_published`,
      `archived_at` on courses and lessons, the `findCourseBySlug` leak closed
      with a mutation-verified test. Commit `02042f0`.
- [x] **Chunk 2a, shelf queries.** `listShelfCourses` and
      `listProgramProgress`, registered in the isolation harness. Commit
      `001c84b`.
- [ ] **Chunk 2b, the screens.** `/catalogue`, `/catalogue/[slug]`, `/courses`
      as the student shelf, `enrollAction`, browser specs updated for the moved
      URLs.
- [ ] **Chunk 3, one editor** at `/courses/[courseId]/edit`.
- [ ] **Chunk 4, teach** with the coming-soon panels.
- [ ] **Chunk 5, cleanup**: delete `/settings/catalog` and
      `/teach/courses/[courseId]`, rename the nav `Signup` link, collapse the
      duplicate uploader and badge.

## Work

Five commits, in order.

### 1. Foundations

- Migration: `lessons.is_published` (default false), `courses.archived_at`,
  `lessons.archived_at`, all nullable timestamps.
- `src/lib/access/can.ts`: a single `can(viewer, action, resource)` facade over
  the existing, tested `decideCourseAuthoring` / `decideLessonAuthoring` /
  `decideLessonAccess`. It delegates rather than replaces, so the isolation
  coverage those already carry stays meaningful. Actions:
  `course:create|edit|publish|archive|enroll|view`, `lesson:*`.
- Fix `findCourseBySlug` to filter published, with an `includeUnpublished`
  option for the admin path.

### 2. Catalogue and the student shelf

- `/catalogue` public, `/catalogue/[slug]` course detail (moved from
  `/courses/[slug]`).
- `/courses` becomes the student's shelf: per course progress bar from
  `progress`, next lesson, Continue or Start. Program section with per-course
  status and overall percentage.
- New repository reads in `src/db/repositories/` for shelf progress and program
  progress; register every one in `tests/helpers/read-paths.ts`, which the
  coverage test enforces.
- `enrollAction`: inserts into `enrollments` with `granted_by` null, reusing the
  duplicate handling in `src/lib/entitlements/grants.ts`.

### 3. One editor

- `/courses/[courseId]/edit`, replacing `/teach/courses/[courseId]`.
- One `LessonList` component, role-driven: staff get Edit, Publish toggle,
  Archive, and up/down reorder; students get View or a locked state.
- Add lesson creates immediately and opens inline, as it does now.
- Reorder action rewrites `sort_order` for the affected pair.
- Creating a course lands here, not back on the catalogue.

### 4. Teach

- `/teach` lists assigned courses with enrolled counts and Manage lessons.
- Course teach view gains Grading, Assessments and Roster panels with explicit
  "coming soon" bodies. No links that 404, no grading logic.
- Replace the inline role comparison with `can`.

### 5. Cleanup

- Delete `/settings/catalog` and `/teach/courses/[courseId]`. One way to create
  a course.
- Nav: rename the admin `Signup` link to `Signup settings` (it is the settings
  page, not an auth link; auth links are already mutually exclusive), point
  Catalogue at `/catalogue`.
- Collapse the duplicate uploader and badge into shared components.
- Update the browser specs that address the moved URLs.

## Deliberately not done

- Payments. Enroll ignores price by decision.
- Grading and assessments beyond the placeholder panels.
- Renaming the `/home/user/Lectern` working directory or the GitHub `Lectern`
  redirect. The code sweep is already complete: zero occurrences in tracked
  files, package name `lamplight`, database roles `lamplight_*`. These two are
  deployed resource names and changing them breaks clones and remotes.

## Verification

Drive it as each role in a browser, and report each result:

1. Signed out: catalogue lists only published courses, no admin controls,
   Enroll prompts sign in and returns to the same course. An unpublished
   course's direct URL 404s.
2. Student: enrols from the catalogue, the course appears on `/courses` with
   the next lesson, Start then Continue resume the right lesson, progress and
   program percentage move after completing one.
3. Admin: creates a course from the catalogue, lands in the editor, adds three
   lessons without leaving, reorders, publishes and unpublishes one, archives
   one, archives the course.
4. Instructor: `/teach` shows only assigned courses, Manage lessons opens the
   editor, placeholder panels render.
5. Publish and archive called directly as a student are rejected server-side.

Plus the existing gate: typecheck, lint, format, em dash check, the unit and
isolation suites, and the browser suite.
