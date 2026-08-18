'use client';

import { useState } from 'react';
import { Input } from 'rsuite';
import { FieldLabel } from './form-chrome';

/**
 * The tag control both authoring screens use (mockups 7 and 9).
 *
 * One component rather than one per screen, because the two differ only in
 * what they say when there is nothing yet: a course being created has no tags
 * because nobody has typed any, and a course that has been around a while has
 * none because somebody left it untagged, which is a different sentence.
 *
 * The suggestions are the institute's own vocabulary, which is exactly the set
 * of tags some course here already carries (see setCourseTags in
 * src/lib/catalog/authoring.ts). Offering them first is what stops a catalogue
 * ending up with "Old Testament", "old testament" and "OT" as three chips that
 * filter three overlapping thirds of the same shelf.
 *
 * Held as labels rather than ids all the way to the server. The server matches
 * on the slug it derives, so a label typed here that already exists reuses that
 * row rather than making a second one, and this component never has to know
 * which of the two it just did.
 */
export function TagPicker({
  value,
  onChange,
  suggestions,
  emptyNote,
  suggestionsLabel,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  /** Every tag the institute uses, including the ones already on this course. */
  suggestions: string[];
  emptyNote: string;
  suggestionsLabel?: string;
}) {
  const [draft, setDraft] = useState('');

  // Compared case-insensitively rather than exactly: the server would fold
  // "Prophets" into an existing "prophets" anyway, and a picker that lets
  // somebody add what looks like a second copy and then silently keeps one is
  // worse than one that just does not offer it.
  const held = new Set(value.map((label) => label.toLowerCase()));
  const unused = suggestions.filter((label) => !held.has(label.toLowerCase()));

  function add(label: string) {
    const clean = label.trim().replace(/\s+/g, ' ');
    if (!clean || held.has(clean.toLowerCase())) return;
    onChange([...value, clean]);
  }

  /**
   * The field empties only when it is the field that was submitted. Clicking a
   * suggestion while a half-typed tag sits in the box used to wipe the box,
   * which loses work for the one action that looks least like it could.
   */
  function addDraft() {
    add(draft);
    setDraft('');
  }

  function remove(label: string) {
    onChange(value.filter((entry) => entry !== label));
  }

  return (
    <div className="flex flex-col gap-2.5">
      <FieldLabel note="what students search by">Tags</FieldLabel>

      <div className="flex flex-wrap items-center gap-2">
        {value.length === 0 ? (
          <span className="text-muted-foreground text-(length:--text-label)">
            {emptyNote}
          </span>
        ) : (
          value.map((label) => (
            <span
              key={label}
              className="bg-secondary text-secondary-foreground flex items-center gap-[7px] rounded-full px-[11px] py-[7px] text-(length:--text-label) font-medium"
            >
              {/* Whole pills wrap, never the word inside one. */}
              <span className="whitespace-nowrap">{label}</span>
              <button
                type="button"
                onClick={() => remove(label)}
                aria-label={`Remove ${label}`}
                className="cursor-pointer opacity-60 hover:opacity-100"
              >
                &times;
              </button>
            </span>
          ))
        )}
      </div>

      <div className="flex items-center gap-2.5">
        <div className="max-w-[260px] flex-1">
          <Input
            value={draft}
            onChange={(next: string) => setDraft(next)}
            onKeyDown={(event: React.KeyboardEvent) => {
              // Enter adds the tag rather than submitting the form around it,
              // which is what a text field inside a form does otherwise and
              // would save the course on the way to typing its second tag.
              if (event.key !== 'Enter') return;
              event.preventDefault();
              addDraft();
            }}
            placeholder="Type a tag"
            aria-label="Add a tag"
          />
        </div>
        <button
          type="button"
          onClick={addDraft}
          className="border-border hover:border-primary cursor-pointer rounded-(--radius) border px-[13px] py-[9px] text-(length:--text-label) font-medium transition-colors"
        >
          Add tag
        </button>
      </div>

      {unused.length > 0 && (
        <div className="flex flex-wrap items-center gap-[7px]">
          {suggestionsLabel && (
            <span className="text-muted-foreground text-(length:--text-meta)">
              {suggestionsLabel}
            </span>
          )}
          {unused.map((label) => (
            <button
              key={label}
              type="button"
              onClick={() => add(label)}
              className="border-border text-muted-foreground hover:border-primary hover:text-foreground cursor-pointer rounded-full border border-dashed px-2.5 py-[5px] text-(length:--text-meta) font-medium whitespace-nowrap transition-colors"
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
