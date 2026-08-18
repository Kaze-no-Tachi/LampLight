'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Input, SelectPicker } from 'rsuite';
import { Markdown } from '@/lib/markdown/render';
import {
  assignInstructorAction,
  removeInstructorAction,
  setCoursePricingAction,
  setPublishedAction,
} from '../../catalog-actions';
import { updateCourseAction } from '../../edit-actions';
import {
  FieldLabel,
  FormCard,
  SaveIndicator,
  type SaveState,
} from '../../form-chrome';
import { PricingPicker, soldAsOf, type SoldAs } from '../../pricing-picker';
import { TagPicker } from '../../tag-picker';

export type Staff = { userId: string; name: string; email: string };

export type CourseSettingsData = {
  id: string;
  title: string;
  slug: string;
  descriptionMd: string | null;
  isPublished: boolean;
  priceCents: number;
  isStandalonePurchasable: boolean;
  tags: string[];
  instructors: Staff[];
};

/**
 * What a course is, and how it is sold (mockup 9).
 *
 * WHAT AN INSTRUCTOR SEES AND AN ADMIN DOES NOT. Publishing, pricing and who
 * teaches a course are the institute's decisions, so those three blocks are
 * admin-only and each of their actions asks requireRole again. Title,
 * description and tags are what the course says, which an assigned instructor
 * already writes. `isAdmin` here decides what to render, and never what is
 * allowed: hiding a control is not authorization, and the server would refuse
 * the same call from a hand-made request.
 *
 * THE ADDRESS IS SHOWN, NOT EDITED, unlike on the new-course screen. A course
 * that has been published has been linked to, and quietly moving it because
 * somebody fixed a typo in the title breaks every one of those links with no
 * warning and no redirect. Changing an address wants a deliberate screen with
 * a redirect behind it, which is not this one.
 *
 * One Save button for the whole card, and the two writes it makes are split
 * by who may make them: the content update, and the pricing update when an
 * admin has actually changed the pricing. Publishing and instructor
 * assignment save themselves on the spot, because both are switches rather
 * than text and waiting for a Save to publish reads as broken.
 */
export function CourseSettings({
  course,
  isAdmin,
  tagVocabulary,
  assignableStaff,
  host,
}: {
  course: CourseSettingsData;
  isAdmin: boolean;
  tagVocabulary: string[];
  assignableStaff: Staff[];
  host: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<SaveState>({ kind: 'clean' });
  const [preview, setPreview] = useState(false);

  const [title, setTitle] = useState(course.title);
  const [description, setDescription] = useState(course.descriptionMd ?? '');
  const [tags, setTags] = useState(course.tags);
  const [sold, setSold] = useState<SoldAs>(soldAsOf(course));
  const [price, setPrice] = useState(
    course.priceCents > 0 ? String(course.priceCents / 100) : '',
  );

  /** Every edit reports itself, so the indicator never lags the fields. */
  function touch<T>(set: (value: T) => void) {
    return (value: T) => {
      set(value);
      setState({ kind: 'dirty' });
    };
  }

  function save() {
    setState({ kind: 'saving' });

    const content = new FormData();
    content.set('courseId', course.id);
    content.set('title', title);
    content.set('descriptionMd', description);
    for (const tag of tags) content.append('tags', tag);

    startTransition(async () => {
      const saved = await updateCourseAction(content);
      if (saved.status === 'error') {
        setState({ kind: 'error', message: saved.message });
        return;
      }

      if (isAdmin) {
        const pricing = new FormData();
        pricing.set('courseId', course.id);
        pricing.set('sold', sold);
        pricing.set('price', price);
        const priced = await setCoursePricingAction(pricing);
        if (priced.status === 'error') {
          setState({ kind: 'error', message: priced.message });
          return;
        }
      }

      setState({ kind: 'saved', at: Date.now() });
      router.refresh();
    });
  }

  function togglePublished() {
    const data = new FormData();
    data.set('courseId', course.id);
    data.set('publish', String(!course.isPublished));

    startTransition(async () => {
      const result = await setPublishedAction(data);
      if (result.status === 'error') {
        setState({ kind: 'error', message: result.message });
        return;
      }
      router.refresh();
    });
  }

  function assign(userId: string | null) {
    if (!userId) return;
    const data = new FormData();
    data.set('courseId', course.id);
    data.set('userId', userId);

    startTransition(async () => {
      const result = await assignInstructorAction(data);
      if (result.status === 'error') {
        setState({ kind: 'error', message: result.message });
        return;
      }
      router.refresh();
    });
  }

  function unassign(userId: string) {
    const data = new FormData();
    data.set('courseId', course.id);
    data.set('userId', userId);

    startTransition(async () => {
      const result = await removeInstructorAction(data);
      if (result.status === 'error') {
        setState({ kind: 'error', message: result.message });
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="flex-1 text-(length:--text-staff-page) leading-[1.2]">
          Course settings
        </h1>
        <SaveIndicator state={state} />
        <button
          type="button"
          disabled={pending}
          onClick={save}
          className="bg-primary text-primary-foreground cursor-pointer rounded-(--radius) px-4 py-2.5 text-(length:--text-ui) font-medium disabled:opacity-60"
        >
          Save course
        </button>
      </div>

      {isAdmin && (
        // Named because the lesson rows further down this same screen also
        // offer a Publish button, so "the Publish button" is ambiguous
        // wherever a course has a draft lesson in it.
        <section
          data-testid="publish-card"
          className="border-border bg-card flex flex-wrap items-center gap-[18px] rounded-(--radius) border px-6 py-[22px]"
        >
          <div className="flex flex-1 flex-col gap-[3px]">
            <span className="text-(length:--text-ui) font-medium">
              {course.isPublished
                ? 'On your catalogue'
                : 'A draft, visible only here'}
            </span>
            <span className="text-muted-foreground text-(length:--text-label)">
              {course.isPublished
                ? 'Anybody can find this course. Withdrawing it takes it off the catalogue and leaves everyone already enrolled exactly where they are.'
                : 'Nothing about this course is public yet, so you can build it in the open.'}
            </span>
          </div>
          {/*
            A button, not a toggle, which is what mockup 9 draws and what this
            control should have been from the start. Two reasons it went back.

            The card already says the state in a sentence, so a switch made the
            screen state it twice and left the reader working out which half
            was the control. A button says the act instead.

            And rsuite's Toggle puts a hidden input under a decorated track, so
            the accessible control is not the thing on screen and nothing can
            click it: the browser suite spent thirty seconds per attempt being
            told the track intercepts the pointer. Whether students can see a
            course is the most consequential switch on this screen, and one no
            test can reach is one whose behaviour is never actually checked.
            The same reasoning retired rsuite's DatePicker from the enrolment
            panel (see docs/plans/rsuite-adoption.md).
          */}
          <button
            type="button"
            disabled={pending}
            onClick={togglePublished}
            className="border-border hover:border-primary shrink-0 cursor-pointer rounded-(--radius) border px-3.5 py-2.5 text-(length:--text-label) font-medium transition-colors disabled:opacity-60"
          >
            {course.isPublished ? 'Unpublish' : 'Publish'}
          </button>
        </section>
      )}

      <FormCard>
        <label className="flex flex-col gap-[7px]">
          <FieldLabel>Title</FieldLabel>
          <Input
            value={title}
            onChange={touch(setTitle)}
            size="lg"
            aria-label="Course title"
          />
          <span className="text-muted-foreground font-mono text-(length:--text-meta)">
            {host}/catalogue/{course.slug}
          </span>
        </label>

        <TagPicker
          value={tags}
          onChange={touch(setTags)}
          suggestions={tagVocabulary}
          emptyNote="No tags yet. An untagged course only turns up by its title."
          suggestionsLabel="Already used here:"
        />

        {isAdmin && (
          <div className="flex flex-col gap-[7px]">
            <FieldLabel>Who teaches it</FieldLabel>

            {course.instructors.length === 0 ? (
              <span className="text-muted-foreground text-(length:--text-label)">
                Nobody yet. An unassigned course can still be edited by an
                admin.
              </span>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {course.instructors.map((person) => (
                  <li
                    key={person.userId}
                    className="bg-secondary text-secondary-foreground flex items-center gap-[7px] rounded-full px-[11px] py-[7px] text-(length:--text-label) font-medium"
                  >
                    <span>
                      {person.name} ({person.email})
                    </span>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => unassign(person.userId)}
                      aria-label={`Remove ${person.name}`}
                      className="cursor-pointer opacity-60 hover:opacity-100 disabled:opacity-30"
                    >
                      &times;
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {assignableStaff.length > 0 && (
              <SelectPicker
                data={assignableStaff.map((person) => ({
                  value: person.userId,
                  label: `${person.name} (${person.email})`,
                }))}
                value={null}
                onChange={assign}
                placeholder="Assign somebody"
                searchable={assignableStaff.length > 8}
                disabled={pending}
                // Cleared on pick rather than holding the last choice: this is
                // an action, not a field, and a picker still showing the
                // person you just assigned reads as though it did nothing.
                cleanable={false}
                block
              />
            )}
          </div>
        )}

        <div className="flex flex-col gap-[7px]">
          <div className="flex items-baseline justify-between gap-4">
            <FieldLabel>What a visitor reads in the catalogue</FieldLabel>
            <button
              type="button"
              onClick={() => setPreview((current) => !current)}
              className="text-muted-foreground cursor-pointer text-(length:--text-meta) font-medium underline underline-offset-[3px]"
            >
              {preview ? 'Back to editing' : 'Preview as a visitor'}
            </button>
          </div>

          {preview ? (
            <div className="border-border min-h-40 rounded-(--radius) border px-5 py-[18px]">
              <Markdown source={description} />
            </div>
          ) : (
            <Input
              as="textarea"
              rows={6}
              value={description}
              onChange={touch(setDescription)}
              placeholder="Two or three sentences. What the course covers, and who it is for."
              aria-label="Catalogue description"
            />
          )}

          <span className="text-muted-foreground text-(length:--text-meta)">
            Headings with ##, **bold**, *italic*, lists with -, and
            [links](https://example.edu). Anything else is shown as you typed
            it.
          </span>
        </div>

        {isAdmin && (
          <PricingPicker
            sold={sold}
            onSold={touch(setSold)}
            priceDollars={price}
            onPriceDollars={touch(setPrice)}
            note="Changing the price never affects anyone who already bought it."
          />
        )}
      </FormCard>
    </div>
  );
}
