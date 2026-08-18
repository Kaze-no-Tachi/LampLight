'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Checkbox, Input } from 'rsuite';
import { formatBytes } from '@/lib/media/uploads';
import { addLessonToCourseAction } from '../../../../actions';
import { FieldLabel, FormCard } from '../../../../form-chrome';
import { uploadLabel, useAudioUpload } from '../../../../use-audio-upload';

export type Section = { id: string; title: string; lessonCount: number };

/**
 * Adding a lesson, with the recording if it is ready (mockup 8).
 *
 * SECTIONS ARE DISCLOSED, NOT PRESENTED. Round 2 decided a course comes with
 * one section nobody ever sees, because an institute writing its first course
 * has no use for the concept. That decision holds here: with one section this
 * screen shows a quiet link and nothing else, and the picker only appears for
 * a course that already has sections to tell apart. The link is also the only
 * way to make a second one, which has had no control at all since the old
 * /teach workspace was retired.
 *
 * THE RECORDING IS UPLOADED AFTER THE LESSON EXISTS, not before. The presigned
 * PUT is issued against a lesson id and the key is built on the server from
 * it, which is what stops a signed upload from being an arbitrary write into
 * the bucket. So the order is: create, upload, then open the editor. An upload
 * that fails leaves a real lesson with no recording, which is a state the
 * editor already handles and says so; losing the lesson as well would be
 * worse.
 *
 * Handouts are not here even though the mockup offers them. They need the same
 * after-the-fact upload as the audio for a gain the screen's own copy talks
 * out of it: the notes and the handouts go in on the next screen, whenever
 * they exist.
 */
export function NewLesson({
  course,
  sections,
}: {
  course: { id: string; title: string };
  sections: Section[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const audio = useAudioUpload();

  const [title, setTitle] = useState('');
  const [sectionId, setSectionId] = useState<string | null>(
    sections[0]?.id ?? null,
  );
  const [newSection, setNewSection] = useState<string | null>(null);
  const [isFreePreview, setIsFreePreview] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const manySections = sections.length > 1;
  const namingNew = newSection !== null;

  const destination =
    namingNew && newSection.trim()
      ? `${newSection.trim()} · ${course.title}`
      : manySections && sectionId
        ? `${sections.find((s) => s.id === sectionId)?.title} · ${course.title}`
        : course.title;

  function create() {
    const data = new FormData();
    data.set('courseId', course.id);
    data.set('title', title);
    if (namingNew && newSection.trim()) {
      data.set('newModule', newSection.trim());
    } else if (manySections && sectionId) {
      data.set('moduleId', sectionId);
    }
    if (isFreePreview) data.set('isFreePreview', 'on');

    startTransition(async () => {
      const result = await addLessonToCourseAction(data);
      if (result.status === 'error') {
        setError(result.message);
        return;
      }

      if (file) {
        const failure = await audio.upload(result.lessonId, file);
        if (failure) {
          // The lesson is real either way, so this goes to its editor with
          // the reason rather than stranding somebody on a form whose submit
          // already worked.
          setError(failure);
          router.push(`/teach/lessons/${result.lessonId}`);
          return;
        }
      }

      router.push(`/teach/lessons/${result.lessonId}`);
    });
  }

  const busy = pending || audio.phase !== 'idle';

  return (
    <div className="flex max-w-[720px] flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link
          href={`/teach/courses/${course.id}`}
          className="text-muted-foreground w-fit text-(length:--text-label) font-medium underline-offset-4 hover:underline"
        >
          {course.title}
        </Link>
        <h1 className="text-(length:--text-staff-page) leading-[1.2]">
          Add a lesson
        </h1>
        <p className="text-muted-foreground max-w-[64ch] text-(length:--text-ui) leading-[1.6]">
          A title and it exists. The notes and the handouts go in on the next
          screen, whenever you have them.
        </p>
      </div>

      <FormCard>
        <label className="flex flex-col gap-[7px]">
          <FieldLabel>Lesson title</FieldLabel>
          <Input
            value={title}
            onChange={(next: string) => setTitle(next)}
            placeholder="Hosea and a marriage as a sign"
            size="lg"
          />
        </label>

        {manySections && !namingNew && (
          <div className="flex flex-col gap-2.5">
            <FieldLabel>Which section</FieldLabel>
            <div className="flex flex-wrap gap-2.5">
              {sections.map((section) => (
                <button
                  key={section.id}
                  type="button"
                  aria-pressed={section.id === sectionId}
                  onClick={() => setSectionId(section.id)}
                  className={`flex cursor-pointer flex-col gap-0.5 rounded-(--radius) border px-3.5 py-[11px] text-left transition-colors ${
                    section.id === sectionId
                      ? 'border-primary bg-accent'
                      : 'border-border hover:border-primary'
                  }`}
                >
                  <span className="text-(length:--text-ui) font-medium">
                    {section.title}
                  </span>
                  <span className="text-muted-foreground text-(length:--text-meta)">
                    {section.lessonCount === 1
                      ? '1 lesson'
                      : `${section.lessonCount} lessons`}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {namingNew ? (
          <label className="flex flex-col gap-[7px]">
            <FieldLabel>
              {sections.length === 0 ? 'Name its first section' : 'New section'}
            </FieldLabel>
            <Input
              value={newSection}
              onChange={(next: string) => setNewSection(next)}
              placeholder="Section title"
            />
            <button
              type="button"
              onClick={() => setNewSection(null)}
              className="text-muted-foreground w-fit cursor-pointer text-(length:--text-meta) underline underline-offset-[3px]"
            >
              {manySections
                ? 'Use one of the sections above instead'
                : 'Leave it where the other lessons are'}
            </button>
          </label>
        ) : (
          <button
            type="button"
            onClick={() => setNewSection('')}
            className="text-muted-foreground w-fit cursor-pointer text-(length:--text-meta) underline underline-offset-[3px]"
          >
            Put it in a new section
          </button>
        )}

        <div className="flex flex-col gap-2.5">
          <FieldLabel note="optional, add it now or later">
            Recording
          </FieldLabel>

          {file ? (
            <div className="border-border bg-muted flex flex-wrap items-center gap-3.5 rounded-(--radius) border px-4 py-3.5">
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-(length:--text-ui) font-medium">
                  {file.name}
                </span>
                <span className="text-muted-foreground text-(length:--text-meta)">
                  {audio.phase === 'idle'
                    ? `${formatBytes(file.size)}, sent when you create the lesson`
                    : uploadLabel(audio.phase, audio.progress, '')}
                </span>
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() => setFile(null)}
                className="text-muted-foreground cursor-pointer text-(length:--text-label) font-medium underline-offset-4 hover:underline disabled:opacity-60"
              >
                Remove
              </button>
            </div>
          ) : (
            <label
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                const dropped = event.dataTransfer.files?.[0];
                if (dropped) setFile(dropped);
              }}
              className={`bg-background flex cursor-pointer items-center gap-3.5 rounded-(--radius) border border-dashed px-4 py-[18px] transition-colors ${
                dragging ? 'border-primary' : 'border-border'
              }`}
            >
              <span className="bg-secondary text-secondary-foreground flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full">
                &uarr;
              </span>
              <span className="flex flex-col gap-0.5">
                <span className="text-(length:--text-ui) font-medium">
                  Drop the audio here, or choose a file
                </span>
                <span className="text-muted-foreground text-(length:--text-meta)">
                  m4a, mp3 or wav. Length is read from the file, not typed.
                </span>
              </span>
              <input
                ref={audio.inputRef}
                type="file"
                accept="audio/*"
                className="hidden"
                onChange={(event) => {
                  const chosen = event.target.files?.[0];
                  if (chosen) setFile(chosen);
                }}
              />
            </label>
          )}
        </div>

        {/* The explanation sits under the control rather than inside its
            label: rsuite lays a Checkbox out as one line and a block of two
            lines inside it wraps around the box instead of beside it. */}
        <div className="flex flex-col">
          <Checkbox
            checked={isFreePreview}
            onChange={(_value, checked: boolean) => setIsFreePreview(checked)}
          >
            <span className="text-(length:--text-ui) font-semibold">
              Open to everyone
            </span>
          </Checkbox>
          <span className="text-muted-foreground max-w-[58ch] pl-9 text-(length:--text-label) leading-[1.5]">
            Usually only the first lesson of a course, so people can listen
            before they decide.
          </span>
        </div>

        <div className="border-border flex flex-wrap items-center gap-3.5 border-t pt-[18px]">
          <button
            type="button"
            disabled={busy}
            onClick={create}
            className="bg-primary text-primary-foreground cursor-pointer rounded-(--radius) px-[17px] py-[11px] text-(length:--text-ui) font-medium disabled:opacity-60"
          >
            {busy
              ? uploadLabel(audio.phase, audio.progress, 'Creating')
              : 'Create lesson'}
          </button>
          <Link
            href={`/teach/courses/${course.id}`}
            className="text-muted-foreground text-(length:--text-label) font-medium underline-offset-4 hover:underline"
          >
            Cancel
          </Link>
          {error && (
            <span
              role="status"
              className="text-destructive text-(length:--text-label)"
            >
              {error}
            </span>
          )}
          <span className="text-muted-foreground ml-auto text-(length:--text-meta)">
            Goes into {destination}
          </span>
        </div>
      </FormCard>
    </div>
  );
}
