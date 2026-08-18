'use client';

import { useMemo, useState } from 'react';
import { Input } from 'rsuite';
import { TeachCourse, type Course } from './teach-course';

/**
 * Search and filtering over the teaching list.
 *
 * Client-side, over a list already loaded, for the same reason the catalogue
 * filters that way: an institute has tens of courses, not thousands, and a
 * round trip per keystroke buys nothing. The cards themselves are unchanged and
 * still own their own write actions.
 *
 * "Needs audio" is the filter worth having and the reason the shape counts are
 * loaded at all. The other three are states somebody can already see; this one
 * answers "what is unfinished", which is the question that brings staff to this
 * screen in the first place.
 */

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'published', label: 'Published' },
  { key: 'draft', label: 'Draft' },
  { key: 'audio', label: 'Needs audio' },
] as const;

type FilterKey = (typeof FILTERS)[number]['key'];

export function TeachList({
  courses,
  isAdmin,
}: {
  courses: Course[];
  /** Instructors see no publish state, so those two filters are not theirs. */
  isAdmin: boolean;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FilterKey>('all');

  const available = isAdmin
    ? FILTERS
    : FILTERS.filter((entry) => entry.key === 'all' || entry.key === 'audio');

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();

    return courses.filter((course) => {
      if (filter === 'published' && !course.admin?.isPublished) return false;
      if (filter === 'draft' && course.admin?.isPublished !== false) {
        return false;
      }
      if (filter === 'audio' && course.shape.awaitingAudio === 0) return false;
      if (!needle) return true;
      return course.title.toLowerCase().includes(needle);
    });
  }, [courses, query, filter]);

  const narrowed = query.trim() !== '' || filter !== 'all';
  const count = narrowed
    ? `${matches.length} of ${courses.length} courses`
    : `All ${courses.length} courses`;

  function clear() {
    setQuery('');
    setFilter('all');
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3.5">
        <div className="min-w-60 flex-1">
          <Input
            value={query}
            onChange={(value: string) => setQuery(value)}
            placeholder="Search courses"
            aria-label="Search courses"
          />
        </div>

        <div className="flex flex-wrap gap-1.5">
          {available.map((entry) => (
            <button
              key={entry.key}
              type="button"
              aria-pressed={filter === entry.key}
              onClick={() => setFilter(entry.key)}
              className={`cursor-pointer rounded-full border px-3 py-1.5 text-(length:--text-label) font-medium transition-colors ${
                filter === entry.key
                  ? 'bg-primary text-primary-foreground border-transparent'
                  : 'border-border hover:border-primary'
              }`}
            >
              {entry.label}
            </button>
          ))}
        </div>

        <span className="text-muted-foreground text-(length:--text-label) whitespace-nowrap">
          {count}
        </span>
      </div>

      {matches.length === 0 ? (
        <p className="text-muted-foreground text-(length:--text-ui)">
          Nothing under that.{' '}
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
        <div className="flex flex-col gap-4">
          {matches.map((course) => (
            <TeachCourse key={course.id} course={course} />
          ))}
        </div>
      )}
    </div>
  );
}
