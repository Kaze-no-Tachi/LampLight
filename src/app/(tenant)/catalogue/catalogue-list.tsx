'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Input, Panel, Tag } from 'rsuite';

/**
 * The searchable half of the catalogue.
 *
 * A client component because the search and the tag chips filter in the
 * browser, and a catalogue is small enough that filtering a loaded list beats
 * a round trip per keystroke. The rows themselves are plain links, so the
 * catalogue still works and is still crawlable before this hydrates.
 *
 * Every course's access state is decided on the server and arrives here as a
 * label. This component must not infer one: what a viewer may do is answered
 * by `can` and the access predicate, and a second opinion computed in the
 * browser is how the two drift apart.
 */

export type CatalogueRow = {
  id: string;
  slug: string;
  title: string;
  blurb: string;
  meta: string;
  priceLabel: string;
  stateLabel: string;
  /** rsuite Tag colors are a fixed set; null renders the neutral tag. */
  stateColor: 'green' | 'blue' | null;
  tags: { id: string; slug: string; label: string }[];
};

export type CatalogueTag = { id: string; slug: string; label: string };

/** How many filter chips the row offers before it stops. */
const QUICK_TAGS = 5;

export function CatalogueList({
  courses,
  tags,
}: {
  courses: CatalogueRow[];
  tags: CatalogueTag[];
}) {
  const [query, setQuery] = useState('');
  const [activeTag, setActiveTag] = useState<string | null>(null);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();

    return courses.filter((course) => {
      if (activeTag && !course.tags.some((tag) => tag.slug === activeTag)) {
        return false;
      }
      if (!needle) return true;

      // Title, description and tags, which is what the design says search
      // covers. Tag labels are included so that typing a subject finds the
      // courses carrying it even when the word is absent from the title.
      return (
        course.title.toLowerCase().includes(needle) ||
        course.blurb.toLowerCase().includes(needle) ||
        course.tags.some((tag) => tag.label.toLowerCase().includes(needle))
      );
    });
  }, [courses, query, activeTag]);

  const filtered = query.trim() !== '' || activeTag !== null;
  const count = filtered
    ? `${matches.length} of ${courses.length} courses`
    : `All ${courses.length} courses`;

  function clear() {
    setQuery('');
    setActiveTag(null);
  }

  return (
    <div className="flex flex-col gap-[18px]">
      <div className="flex flex-wrap items-center gap-3.5">
        <div className="min-w-60 flex-1">
          <Input
            value={query}
            onChange={(value: string) => setQuery(value)}
            placeholder="Search by title or tag"
            aria-label="Search courses"
          />
        </div>

        <div className="flex flex-wrap gap-[7px]">
          {tags.slice(0, QUICK_TAGS).map((tag) => (
            <button
              key={tag.id}
              type="button"
              aria-pressed={activeTag === tag.slug}
              onClick={() =>
                setActiveTag(activeTag === tag.slug ? null : tag.slug)
              }
              className="cursor-pointer"
            >
              <Tag color={activeTag === tag.slug ? 'blue' : undefined}>
                {tag.label}
              </Tag>
            </button>
          ))}
        </div>

        <span className="text-muted-foreground text-(length:--text-label) whitespace-nowrap">
          {count}
        </span>
      </div>

      {matches.length === 0 ? (
        <p className="text-muted-foreground text-(length:--text-ui)">
          Nothing under that yet.{' '}
          <button
            type="button"
            onClick={clear}
            className="cursor-pointer underline underline-offset-[3px]"
          >
            Show every course
          </button>
          .
        </p>
      ) : (
        <Panel bordered bodyFill className="bg-card overflow-hidden">
          {matches.map((course) => (
            <CourseRow key={course.id} course={course} onTag={setActiveTag} />
          ))}
        </Panel>
      )}
    </div>
  );
}

/**
 * One catalogue row.
 *
 * The title is the link and it is stretched over the whole row, so the row is
 * one target. The tag chips sit above that stretched layer on purpose: a tag
 * is a filter, and a reader who taps one expects the catalogue to narrow
 * rather than to open whichever course happened to be underneath.
 */
function CourseRow({
  course,
  onTag,
}: {
  course: CatalogueRow;
  onTag: (slug: string) => void;
}) {
  return (
    <div className="border-border hover:bg-muted relative flex items-center gap-6 px-6 py-5 transition-colors not-first:border-t">
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <Link
          href={`/catalogue/${course.slug}`}
          className="font-serif text-(length:--text-row-title) leading-snug after:absolute after:inset-0 after:content-['']"
        >
          {course.title}
        </Link>

        <span className="text-muted-foreground text-(length:--text-label)">
          {course.meta}
        </span>

        {course.tags.length > 0 ? (
          <div className="relative z-10 flex flex-wrap gap-1.5">
            {course.tags.map((tag) => (
              <button
                key={tag.id}
                type="button"
                onClick={() => onTag(tag.slug)}
                className="cursor-pointer"
              >
                <Tag size="sm">{tag.label}</Tag>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <Tag color={course.stateColor ?? undefined} size="sm">
        {course.stateLabel}
      </Tag>

      <span className="w-24 shrink-0 text-right text-(length:--text-ui) font-medium">
        {course.priceLabel}
      </span>
    </div>
  );
}
